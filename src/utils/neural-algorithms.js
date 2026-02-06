import crypto from 'crypto';

/**
 * 文本相似度计算（基于Jaccard相似度和编辑距离）
 * 使用轻量级算法，适合实时场景
 */
export class TextSimilarity {
  /**
   * 计算Jaccard相似度（基于字符n-gram）
   * @param {string} text1 - 文本1
   * @param {string} text2 - 文本2
   * @param {number} n - n-gram大小，默认2
   * @returns {number} 相似度 0-1
   */
  static jaccardSimilarity(text1, text2, n = 2) {
    if (!text1 || !text2) return 0;
    if (text1 === text2) return 1;

    const getNGrams = (text) => {
      const grams = new Set();
      for (let i = 0; i <= text.length - n; i++) {
        grams.add(text.slice(i, i + n));
      }
      return grams;
    };

    const set1 = getNGrams(text1.toLowerCase());
    const set2 = getNGrams(text2.toLowerCase());

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 计算编辑距离（Levenshtein距离）
   * @param {string} text1 - 文本1
   * @param {string} text2 - 文本2
   * @returns {number} 编辑距离
   */
  static levenshteinDistance(text1, text2) {
    if (!text1) return text2 ? text2.length : 0;
    if (!text2) return text1.length;
    if (text1 === text2) return 0;

    const m = text1.length;
    const n = text2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (text1[i - 1] === text2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,     // 删除
            dp[i][j - 1] + 1,     // 插入
            dp[i - 1][j - 1] + 1  // 替换
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * 计算归一化相似度（基于编辑距离）
   * @param {string} text1 - 文本1
   * @param {string} text2 - 文本2
   * @returns {number} 相似度 0-1
   */
  static normalizedSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    if (text1 === text2) return 1;

    const maxLen = Math.max(text1.length, text2.length);
    if (maxLen === 0) return 1;

    const distance = this.levenshteinDistance(text1, text2);
    return 1 - (distance / maxLen);
  }

  /**
   * 综合相似度（结合Jaccard和编辑距离）
   * @param {string} text1 - 文本1
   * @param {string} text2 - 文本2
   * @returns {number} 综合相似度 0-1
   */
  static combinedSimilarity(text1, text2) {
    const jaccard = this.jaccardSimilarity(text1, text2);
    const normalized = this.normalizedSimilarity(text1, text2);
    // 加权平均：Jaccard权重0.4，编辑距离权重0.6
    return jaccard * 0.4 + normalized * 0.6;
  }
}

/**
 * 事件去重器（使用向量相似度）
 * 基于文本相似度和时间窗口的智能去重
 */
export class EventDeduplicator {
  constructor(options = {}) {
    this.similarityThreshold = options.similarityThreshold || 0.85;
    this.timeWindow = options.timeWindow || 60000; // 1分钟
    this.maxHistory = options.maxHistory || 1000;
    this.recentEvents = new Map(); // eventId -> { event, timestamp, fingerprint }
    this.cleanupInterval = null;
    this.startCleanup();
  }

  /**
   * 生成事件指纹（用于快速比较）
   */
  generateFingerprint(event) {
    const key = `${event.tasker || ''}:${event.post_type || ''}:${event.user_id || ''}`;
    const content = (event.plainText || event.raw_message || event.msg || '').slice(0, 100);
    const hash = crypto.createHash('md5').update(key + content).digest('hex');
    return hash;
  }

  /**
   * 检查事件是否重复
   * @param {Object} event - 事件对象
   * @returns {boolean} 是否重复
   */
  isDuplicate(event) {
    const now = Date.now();
    const fingerprint = this.generateFingerprint(event);
    const eventId = event.event_id || fingerprint;

    // 快速检查：相同指纹
    for (const [, record] of this.recentEvents.entries()) {
      if (record.fingerprint === fingerprint) {
        const timeDiff = now - record.timestamp;
        if (timeDiff < this.timeWindow) {
          return true; // 相同指纹且在时间窗口内
        }
      }
    }

    // 慢速检查：相似度匹配
    const content = event.plainText || event.raw_message || event.msg || '';
    if (content.length > 10) { // 只对较长文本进行相似度检查
      for (const [, record] of this.recentEvents.entries()) {
        const recordContent = record.event.plainText || record.event.raw_message || record.event.msg || '';
        if (recordContent.length > 10) {
          const timeDiff = now - record.timestamp;
          if (timeDiff < this.timeWindow) {
            const similarity = TextSimilarity.combinedSimilarity(content, recordContent);
            if (similarity >= this.similarityThreshold) {
              return true; // 高相似度且在时间窗口内
            }
          }
        }
      }
    }

    // 记录新事件
    this.recentEvents.set(eventId, {
      event,
      timestamp: now,
      fingerprint
    });

    // 限制历史记录大小
    if (this.recentEvents.size > this.maxHistory) {
      this.cleanup();
    }

    return false;
  }

  /**
   * 清理过期事件
   */
  cleanup() {
    const now = Date.now();
    const toDelete = [];

    for (const [id, record] of this.recentEvents.entries()) {
      if (now - record.timestamp > this.timeWindow * 2) {
        toDelete.push(id);
      }
    }

    toDelete.forEach(id => this.recentEvents.delete(id));
  }

  /**
   * 启动定期清理
   */
  startCleanup() {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.timeWindow);
  }

  /**
   * 停止清理
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 清空所有记录
   */
  clear() {
    this.recentEvents.clear();
  }
}

/**
 * 智能缓存策略（基于LRU和访问频率）
 * 使用简单的神经网络思想：根据访问模式调整缓存策略
 */
export class IntelligentCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.ttl = options.ttl || 3600000; // 1小时
    this.cache = new Map(); // key -> { value, timestamp, accessCount, lastAccess }
    this.accessPatterns = new Map(); // key -> accessHistory
    this.cleanupInterval = null;
    this.startCleanup();
  }

  /**
   * 获取缓存值
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.accessPatterns.delete(key);
      return null;
    }

    // 更新访问统计
    entry.accessCount = (entry.accessCount || 0) + 1;
    entry.lastAccess = now;

    // 记录访问模式
    this.recordAccess(key);

    return entry.value;
  }

  /**
   * 设置缓存值
   */
  set(key, value) {
    const now = Date.now();

    // 如果缓存已满，使用智能淘汰策略
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLeastValuable();
    }

    this.cache.set(key, {
      value,
      timestamp: now,
      accessCount: 1,
      lastAccess: now
    });

    this.recordAccess(key);
  }

  /**
   * 记录访问模式（用于预测未来访问）
   */
  recordAccess(key) {
    if (!this.accessPatterns.has(key)) {
      this.accessPatterns.set(key, []);
    }

    const history = this.accessPatterns.get(key);
    history.push(Date.now());

    // 只保留最近20次访问记录
    if (history.length > 20) {
      history.shift();
    }
  }

  /**
   * 计算键的访问价值（基于访问频率和最近访问时间）
   * 使用简单的加权评分
   */
  calculateValue(entry, _key) {
    const now = Date.now();
    const timeSinceLastAccess = now - (entry.lastAccess || entry.timestamp);
    const accessCount = entry.accessCount || 1;

    // 访问频率得分（对数缩放，避免过度偏向高频）
    const frequencyScore = Math.log(1 + accessCount) / Math.log(2);

    // 时间衰减得分（最近访问的得分更高）
    const timeDecay = Math.exp(-timeSinceLastAccess / (this.ttl * 0.5));

    // 综合得分
    return frequencyScore * 0.6 + timeDecay * 0.4;
  }

  /**
   * 智能淘汰：淘汰价值最低的项
   */
  evictLeastValuable() {
    let minValue = Infinity;
    let minKey = null;

    for (const [key, entry] of this.cache.entries()) {
      const value = this.calculateValue(entry, key);
      if (value < minValue) {
        minValue = value;
        minKey = key;
      }
    }

    if (minKey) {
      this.cache.delete(minKey);
      this.accessPatterns.delete(minKey);
    }
  }

  /**
   * 清理过期项
   */
  cleanup() {
    const now = Date.now();
    const toDelete = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        toDelete.push(key);
      }
    }

    toDelete.forEach(key => {
      this.cache.delete(key);
      this.accessPatterns.delete(key);
    });
  }

  /**
   * 启动定期清理
   */
  startCleanup() {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
      // 如果缓存仍然过满，继续淘汰
      if (this.cache.size > this.maxSize * 0.9) {
        while (this.cache.size > this.maxSize * 0.8) {
          this.evictLeastValuable();
        }
      }
    }, this.ttl / 10);
  }

  /**
   * 停止清理
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.accessPatterns.clear();
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    const totalAccess = Array.from(this.cache.values())
      .reduce((sum, entry) => sum + (entry.accessCount || 0), 0);
    
    const avgAccess = this.cache.size > 0 
      ? totalAccess / this.cache.size 
      : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      totalAccess,
      avgAccess: avgAccess.toFixed(2),
      hitRate: this.calculateHitRate()
    };
  }

  /**
   * 计算命中率（需要外部记录）
   */
  calculateHitRate() {
    // 这里可以扩展为记录命中/未命中次数
    return 0; // 占位符
  }
}

/**
 * 插件匹配优化器（使用相似度匹配）
 * 智能匹配插件规则，提高匹配效率
 */
export class PluginMatcher {
  constructor() {
    this.ruleCache = new Map(); // 规则 -> 编译后的匹配器
    this.matchStats = new Map(); // 规则 -> 匹配统计
  }

  /**
   * 编译规则为高效匹配器
   */
  compileRule(rule) {
    const cacheKey = `${rule.reg?.toString() || ''}:${rule.event || ''}`;
    
    if (this.ruleCache.has(cacheKey)) {
      return this.ruleCache.get(cacheKey);
    }

    const matcher = {
      test: (text) => {
        if (rule.reg) {
          return rule.reg.test(text);
        }
        return true;
      },
      similarity: (text) => {
        // 如果规则有文本模式，计算相似度
        if (rule.reg && typeof rule.reg === 'object') {
          const pattern = rule.reg.toString().replace(/[\/\^$]/g, '');
          return TextSimilarity.combinedSimilarity(text, pattern);
        }
        return 0;
      }
    };

    this.ruleCache.set(cacheKey, matcher);
    return matcher;
  }

  /**
   * 智能匹配规则（结合精确匹配和相似度匹配）
   */
  matchRule(rule, event) {
    const matcher = this.compileRule(rule);
    const text = event.plainText || event.msg || '';

    // 精确匹配
    if (matcher.test(text)) {
      this.recordMatch(rule, true);
      return { matched: true, confidence: 1.0 };
    }

    // 相似度匹配（用于模糊匹配场景）
    const similarity = matcher.similarity(text);
    if (similarity > 0.7) {
      this.recordMatch(rule, false);
      return { matched: true, confidence: similarity };
    }

    this.recordMatch(rule, false);
    return { matched: false, confidence: 0 };
  }

  /**
   * 记录匹配统计（用于优化）
   */
  recordMatch(rule, matched) {
    const key = `${rule.reg?.toString() || ''}`;
    if (!this.matchStats.has(key)) {
      this.matchStats.set(key, { total: 0, matched: 0 });
    }

    const stats = this.matchStats.get(key);
    stats.total++;
    if (matched) stats.matched++;
  }

  /**
   * 获取匹配统计
   */
  getMatchStats() {
    const stats = {};
    for (const [key, value] of this.matchStats.entries()) {
      stats[key] = {
        ...value,
        matchRate: value.total > 0 ? (value.matched / value.total).toFixed(2) : 0
      };
    }
    return stats;
  }

  /**
   * 清空缓存
   */
  clear() {
    this.ruleCache.clear();
    this.matchStats.clear();
  }
}

/**
 * 工作流决策器（使用简单的决策树思想）
 * 基于历史数据智能决策是否需要工作流
 */
export class WorkflowDecisionTree {
  constructor() {
    this.decisionHistory = []; // 历史决策记录
    this.patterns = new Map(); // 模式 -> 决策结果
  }

  /**
   * 记录决策历史
   */
  recordDecision(goal, todos, shouldUseTodo) {
    this.decisionHistory.push({
      goal,
      todosCount: todos.length,
      shouldUseTodo,
      timestamp: Date.now()
    });

    // 提取模式
    const pattern = this.extractPattern(goal, todos);
    if (pattern) {
      this.patterns.set(pattern, {
        shouldUseTodo,
        count: (this.patterns.get(pattern)?.count || 0) + 1
      });
    }

    // 限制历史记录大小
    if (this.decisionHistory.length > 1000) {
      this.decisionHistory = this.decisionHistory.slice(-500);
    }
  }

  /**
   * 提取决策模式
   */
  extractPattern(goal, todos) {
    // 基于目标关键词和TODO数量提取模式
    const keywords = goal.toLowerCase().match(/\b\w{3,}\b/g) || [];
    const keyPattern = keywords.slice(0, 3).join('_');
    return `${keyPattern}_${todos.length}`;
  }

  /**
   * 基于历史决策预测
   */
  predict(goal, todos) {
    const pattern = this.extractPattern(goal, todos);
    const history = this.patterns.get(pattern);

    if (history && history.count >= 3) {
      // 如果相同模式有足够的历史记录，使用历史决策
      return {
        shouldUseTodo: history.shouldUseTodo,
        confidence: Math.min(0.9, 0.5 + history.count * 0.1)
      };
    }

    // 否则返回null，让AI决策
    return null;
  }

  /**
   * 获取决策统计
   */
  getStats() {
    const total = this.decisionHistory.length;
    const useWorkflow = this.decisionHistory.filter(d => d.shouldUseTodo).length;
    
    return {
      total,
      useWorkflow,
      useWorkflowRate: total > 0 ? (useWorkflow / total).toFixed(2) : 0,
      patterns: this.patterns.size
    };
  }
}

