/**
 * Memory Manager - 进程内短期/长期记忆（关键词 contains，非向量 RAG）
 */
import EventEmitter from 'events';

export class MemoryManager extends EventEmitter {
  shortTermMemories = new Map();
  longTermMemories = new Map();
  maxShortTermSize = 50;
  maxLongTermSize = 1000;

  /**
   * 添加短期记忆（对话上下文）
   * @param {string} userId - 用户ID
   * @param {Object} memory - 记忆内容
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

    this.emit('memory:short_term:added', { userId, memory });
  }

  getShortTermMemories(userId, limit = 10) {
    const memories = this.shortTermMemories.get(userId) || [];
    return memories.slice(-limit);
  }

  clearShortTermMemory(userId) {
    this.shortTermMemories.delete(userId);
    this.emit('memory:short_term:cleared', { userId });
  }

  /**
   * 添加长期记忆
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

    if (memories.length > this.maxLongTermSize) {
      memories.sort((a, b) => a.importance - b.importance);
      memories.shift();
    }

    this.emit('memory:long_term:added', { userId, memory: longTermMemory });
    return memoryId;
  }

  /**
   * 检索长期记忆（简单 includes，非 embedding）
   */
  async searchLongTermMemories(userId, query, limit = 5) {
    const memories = this.longTermMemories.get(userId) || [];
    const results = memories
      .filter(m => m.content.includes(query))
      .sort((a, b) => {
        const scoreA = a.importance + (a.accessCount * 0.1);
        const scoreB = b.importance + (b.accessCount * 0.1);
        return scoreB - scoreA;
      })
      .slice(0, limit);

    for (const memory of results) {
      memory.accessCount++;
      memory.lastAccessed = Date.now();
    }

    return results;
  }

  deleteLongTermMemory(userId, memoryId) {
    const memories = this.longTermMemories.get(userId);
    if (!memories) return false;

    const index = memories.findIndex(m => m.id === memoryId);
    if (index === -1) return false;

    memories.splice(index, 1);
    this.emit('memory:long_term:deleted', { userId, memoryId });
    return true;
  }

  clearLongTermMemories(userId) {
    this.longTermMemories.delete(userId);
    this.emit('memory:long_term:cleared', { userId });
  }
}

export default new MemoryManager();
