/**
 * Memory Manager — 进程内短期 / 长期记忆（关键词打分召回，非向量 embedding）。
 * - 短期：AiWorkflow.storeMessageMemory / retrieveRelevantContexts
 * - 长期：system-Core `workflow/memory.js` 的 MCP 工具写入与检索
 * 主对话历史仍以 chatSessionHistory / ChatStream.messageHistory 为准。
 */

/** @param {string} text */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * @param {string} content
 * @param {string} query
 * @returns {number} 0..1 关键词重合分
 */
function keywordScore(content, query) {
  const q = String(query || '').trim();
  if (!q) return 0;
  const body = String(content || '');
  if (!body) return 0;
  const lower = body.toLowerCase();
  const qLower = q.toLowerCase();
  if (lower.includes(qLower)) return 1;
  const terms = tokenize(q);
  if (!terms.length) return lower.includes(qLower) ? 1 : 0;
  let hit = 0;
  for (const t of terms) {
    if (lower.includes(t)) hit++;
  }
  return hit / terms.length;
}

export class MemoryManager {
  shortTermMemories = new Map();
  longTermMemories = new Map();
  maxShortTermSize = 50;
  maxLongTermSize = 1000;

  /**
   * @param {string} userId
   * @param {Object} memory
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

    if (memories.length > this.maxShortTermSize) {
      memories.shift();
    }
  }

  /**
   * @param {string} userId
   * @param {number} [limit=10]
   * @returns {Array<Object>}
   */
  getShortTermMemories(userId, limit = 10) {
    const memories = this.shortTermMemories.get(userId) || [];
    return memories.slice(-limit);
  }

  /**
   * 短期记忆关键词召回（空 query 返回最近若干条；有 query 按重合分排序）。
   * @param {string} userId
   * @param {string} query
   * @param {number} [limit=5]
   * @returns {Promise<Array<Object>>}
   */
  async searchShortTermMemories(userId, query, limit = 5) {
    const memories = this.shortTermMemories.get(userId) || [];
    const q = String(query || '').trim();
    if (!q) return memories.slice(-limit).reverse();
    return memories
      .map((m) => ({ ...m, _score: keywordScore(m.content, q) }))
      .filter((m) => m._score > 0)
      .sort((a, b) => b._score - a._score || (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit)
      .map(({ _score, ...rest }) => ({ ...rest, score: _score }));
  }

  /**
   * @param {string} userId
   * @param {Object} memory
   * @returns {Promise<string>} 记忆 ID
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

    if (memories.length > this.maxLongTermSize) {
      memories.sort((a, b) => a.importance - b.importance);
      memories.shift();
    }

    return memoryId;
  }

  /**
   * 长期记忆关键词检索（空 query 按重要度；有 query 先关键词分再叠重要度）。
   * @param {string} userId
   * @param {string} query
   * @param {number} [limit=5]
   * @returns {Promise<Array<Object>>}
   */
  async searchLongTermMemories(userId, query, limit = 5) {
    const memories = this.longTermMemories.get(userId) || [];
    const q = String(query || '').trim();
    const scored = memories.map((m) => {
      const kw = q ? keywordScore(m.content, q) : 1;
      const rank = kw * 2 + (m.importance || 0) + (m.accessCount || 0) * 0.1;
      return { m, kw, rank };
    });
    const results = scored
      .filter((x) => !q || x.kw > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map((x) => x.m);

    for (const memory of results) {
      memory.accessCount++;
      memory.lastAccessed = Date.now();
    }

    return results;
  }

  /**
   * @param {string} userId
   * @param {string} memoryId
   * @returns {boolean}
   */
  deleteLongTermMemory(userId, memoryId) {
    const memories = this.longTermMemories.get(userId);
    if (!memories) return false;

    const index = memories.findIndex((m) => m.id === memoryId);
    if (index === -1) return false;

    memories.splice(index, 1);
    return true;
  }
}

export default new MemoryManager();
