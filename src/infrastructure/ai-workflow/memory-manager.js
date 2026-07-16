/**
 * Memory Manager — 进程内短期 / 长期记忆（关键词 contains，非向量 RAG）。
 * - 短期：AiWorkflow.storeMessageMemory / retrieveRelevantContexts
 * - 长期：system-Core `workflow/memory.js` 的 MCP 工具写入与检索
 * 主对话历史仍以 ChatStream.messageHistory 为准。
 */
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
   * 短期记忆关键词召回（空 query 返回最近若干条）。
   * @param {string} userId
   * @param {string} query
   * @param {number} [limit=5]
   * @returns {Promise<Array<Object>>}
   */
  async searchShortTermMemories(userId, query, limit = 5) {
    const memories = this.shortTermMemories.get(userId) || [];
    const q = String(query || '');
    const filtered = q
      ? memories.filter((m) => String(m.content || '').includes(q))
      : memories;
    return filtered.slice(-limit).reverse();
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
   * 长期记忆关键词检索（空 query 返回全部，按重要度排序）。
   * @param {string} userId
   * @param {string} query
   * @param {number} [limit=5]
   * @returns {Promise<Array<Object>>}
   */
  async searchLongTermMemories(userId, query, limit = 5) {
    const memories = this.longTermMemories.get(userId) || [];
    const q = String(query || '');
    const results = memories
      .filter((m) => !q || String(m.content || '').includes(q))
      .sort((a, b) => {
        const scoreA = a.importance + a.accessCount * 0.1;
        const scoreB = b.importance + b.accessCount * 0.1;
        return scoreB - scoreA;
      })
      .slice(0, limit);

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
