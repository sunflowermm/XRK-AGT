/**
 * Memory Manager - 记忆管理服务
 * 负责短期记忆、长期记忆、记忆检索、记忆压缩等功能
 */
import BotUtil from '#utils/botutil.js';
import EventEmitter from 'events';

export class MemoryManager extends EventEmitter {
  constructor() {
    super();
    this.shortTermMemories = new Map(); // userId -> 对话上下文
    this.longTermMemories = new Map(); // userId -> 长期记忆列表
    this.memoryIndex = new Map(); // 记忆索引（用于快速检索）
    this.maxShortTermSize = 50; // 短期记忆最大条数
    this.maxLongTermSize = 1000; // 长期记忆最大条数
  }

  /**
   * 添加短期记忆（对话上下文）
   * @param {string} userId - 用户ID
   * @param {Object} memory - 记忆内容
   * @param {string} memory.role - 角色（user/assistant/system）
   * @param {string} memory.content - 内容
   * @param {Object} memory.metadata - 元数据
   */
  addShortTermMemory(userId, memory) {
    if (!this.shortTermMemories.has(userId)) {
      this.shortTermMemories.set(userId, []);
    }

    const memories = this.shortTermMemories.get(userId);
    memories.push({
      ...memory,
      timestamp: Date.now(),
      id: `${userId}_${Date.now()}`
    });

    // 限制大小
    if (memories.length > this.maxShortTermSize) {
      memories.shift();
    }

    this.emit('memory:short_term:added', { userId, memory });
  }

  /**
   * 获取短期记忆
   * @param {string} userId - 用户ID
   * @param {number} limit - 限制条数
   * @returns {Array}
   */
  getShortTermMemories(userId, limit = 10) {
    const memories = this.shortTermMemories.get(userId) || [];
    return memories.slice(-limit);
  }

  /**
   * 清空短期记忆
   * @param {string} userId - 用户ID
   */
  clearShortTermMemory(userId) {
    this.shortTermMemories.delete(userId);
    this.emit('memory:short_term:cleared', { userId });
  }

  /**
   * 添加长期记忆
   * @param {string} userId - 用户ID
   * @param {Object} memory - 记忆内容
   * @param {string} memory.content - 内容
   * @param {string} memory.type - 类型（fact/preference/event）
   * @param {Object} memory.metadata - 元数据
   * @returns {string} 记忆ID
   */
  async addLongTermMemory(userId, memory) {
    if (!this.longTermMemories.has(userId)) {
      this.longTermMemories.set(userId, []);
    }

    const memoryId = `lt_${userId}_${Date.now()}`;
    const longTermMemory = {
      id: memoryId,
      userId,
      content: memory.content,
      type: memory.type || 'fact',
      metadata: memory.metadata || {},
      importance: memory.importance || 0.5,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now()
    };

    const memories = this.longTermMemories.get(userId);
    memories.push(longTermMemory);

    // 限制大小
    if (memories.length > this.maxLongTermSize) {
      // 删除最不重要的记忆
      memories.sort((a, b) => a.importance - b.importance);
      memories.shift();
    }

    // 更新索引
    await this.updateMemoryIndex(userId, longTermMemory);

    this.emit('memory:long_term:added', { userId, memory: longTermMemory });
    return memoryId;
  }

  /**
   * 检索长期记忆
   * @param {string} userId - 用户ID
   * @param {string} query - 查询关键词
   * @param {number} limit - 限制条数
   * @returns {Array}
   */
  async searchLongTermMemories(userId, query, limit = 5) {
    const memories = this.longTermMemories.get(userId) || [];
    
    // 简单的关键词匹配（实际应该使用向量检索）
    const results = memories
      .filter(m => m.content.includes(query))
      .sort((a, b) => {
        // 按重要性和访问时间排序
        const scoreA = a.importance + (a.accessCount * 0.1);
        const scoreB = b.importance + (b.accessCount * 0.1);
        return scoreB - scoreA;
      })
      .slice(0, limit);

    // 更新访问统计
    for (const memory of results) {
      memory.accessCount++;
      memory.lastAccessed = Date.now();
    }

    return results;
  }

  /**
   * 删除长期记忆
   * @param {string} userId - 用户ID
   * @param {string} memoryId - 记忆ID
   * @returns {boolean}
   */
  deleteLongTermMemory(userId, memoryId) {
    const memories = this.longTermMemories.get(userId);
    if (!memories) return false;

    const index = memories.findIndex(m => m.id === memoryId);
    if (index === -1) return false;

    memories.splice(index, 1);
    this.emit('memory:long_term:deleted', { userId, memoryId });
    return true;
  }

  /**
   * 压缩记忆（总结和归档）
   * @param {string} userId - 用户ID
   * @param {number} threshold - 压缩阈值（天数）
   */
  async compressMemories(userId, threshold = 30) {
    const memories = this.longTermMemories.get(userId) || [];
    const now = Date.now();
    const thresholdTime = threshold * 24 * 60 * 60 * 1000;

    const oldMemories = memories.filter(m => 
      (now - m.timestamp) > thresholdTime && m.importance < 0.3
    );

    if (oldMemories.length === 0) return;

    // 这里应该调用LLM进行总结，暂时简单处理
    for (const memory of oldMemories) {
      memory.compressed = true;
      memory.content = `[已压缩] ${memory.content.substring(0, 50)}...`;
    }

    this.emit('memory:compressed', { userId, count: oldMemories.length });
    BotUtil.makeLog('info', `压缩 ${oldMemories.length} 条记忆: ${userId}`, 'MemoryManager');
  }

  /**
   * 更新记忆索引
   * @param {string} userId - 用户ID
   * @param {Object} memory - 记忆对象
   */
  async updateMemoryIndex(userId, memory) {
    const key = `${userId}_index`;
    if (!this.memoryIndex.has(key)) {
      this.memoryIndex.set(key, new Map());
    }

    const index = this.memoryIndex.get(key);
    // 简单的关键词索引
    const keywords = memory.content.split(/\s+/).filter(w => w.length > 2);
    for (const keyword of keywords) {
      if (!index.has(keyword)) {
        index.set(keyword, []);
      }
      index.get(keyword).push(memory.id);
    }
  }

  /**
   * 获取用户的所有记忆统计
   * @param {string} userId - 用户ID
   * @returns {Object}
   */
  getMemoryStats(userId) {
    const shortTerm = this.shortTermMemories.get(userId) || [];
    const longTerm = this.longTermMemories.get(userId) || [];

    return {
      shortTerm: {
        count: shortTerm.length,
        maxSize: this.maxShortTermSize
      },
      longTerm: {
        count: longTerm.length,
        maxSize: this.maxLongTermSize,
        byType: longTerm.reduce((acc, m) => {
          acc[m.type] = (acc[m.type] || 0) + 1;
          return acc;
        }, {})
      }
    };
  }

  /**
   * 获取全局统计
   * @returns {Object}
   */
  getGlobalStats() {
    return {
      totalUsers: this.shortTermMemories.size,
      totalShortTermMemories: Array.from(this.shortTermMemories.values())
        .reduce((sum, mems) => sum + mems.length, 0),
      totalLongTermMemories: Array.from(this.longTermMemories.values())
        .reduce((sum, mems) => sum + mems.length, 0)
    };
  }
}

export default new MemoryManager();
