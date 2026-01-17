import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

/**
 * 记忆系统工作流插件
 * 提供长期记忆功能，支持记忆的存储、查询、删除
 */
export default class MemoryStream extends AIStream {
  constructor() {
    super({
      name: 'memory',
      description: '记忆系统工作流插件',
      version: '1.0.0',
      author: 'XRK',
      priority: 1,
      config: {
        enabled: true,
        temperature: 0.7,
        maxTokens: 2000
      },
      embedding: { enabled: true }
    });
    
    // 记忆存储目录
    this.memoryDir = path.join(os.homedir(), '.xrk', 'memory');
    this.memories = new Map(); // 内存中的记忆缓存
  }

  async init() {
    await super.init();
    
    try {
      await this.initEmbedding();
    } catch (error) {
      BotUtil.makeLog('warn', `[${this.name}] Embedding初始化失败，记忆功能可能受限`, 'MemoryStream');
    }

    // 确保记忆目录存在
    await fs.mkdir(this.memoryDir, { recursive: true });

    // 注册记忆相关功能
    this.registerAllFunctions();
    
    // 加载记忆数据
    await this.loadMemories();

    BotUtil.makeLog('info', `[${this.name}] 记忆系统已初始化，已加载 ${this.memories.size} 条记忆`, 'MemoryStream');
  }

  /**
   * 注册所有记忆相关功能
   * 优化：prompt字段动态包含记忆信息
   */
  registerAllFunctions() {
    // 动态获取记忆信息
    const getMemoryPrompt = () => {
      const memories = this.getMemoriesForPrompt({ e: this.context?.e });
      if (memories.length > 0) {
        return `\n当前记忆：${memories.map(m => `#${m.id}: ${m.content.slice(0, 30)}...`).join('、')}`;
      }
      return '';
    };

    // 保存长期记忆
    this.registerFunction('save_memory', {
      description: '保存长期记忆',
      prompt: () => `[长期记忆:content] - 保存一条长期记忆，内容会被持久化存储${getMemoryPrompt()}`,
      parser: (text, context) => {
        const match = text.match(/\[长期记忆:([^\]]+)\]/);
        if (!match) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'save_memory', params: { content: match[1] } }],
          cleanText: text.replace(/\[长期记忆:[^\]]+\]/g, '').trim()
        };
      },
      handler: async (params = {}, context = {}) => {
        const { content } = params;
        if (!content) return;

        const memoryId = await this.saveMemory(content, context);
        await this.storeNoteIfWorkflow(context, `已保存长期记忆 #${memoryId}: ${content}`, 'memory', true);
        BotUtil.makeLog('info', `[${this.name}] 保存记忆 #${memoryId}: ${content.slice(0, 50)}...`, 'MemoryStream');
      },
      enabled: true
    });

    // 查询记忆
    this.registerFunction('query_memory', {
      description: '查询长期记忆',
      prompt: () => `[查询记忆:keyword] - 根据关键词查询相关记忆${getMemoryPrompt()}`,
      parser: (text, context) => {
        const match = text.match(/\[查询记忆:([^\]]+)\]/);
        if (!match) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'query_memory', params: { keyword: match[1] } }],
          cleanText: text.replace(/\[查询记忆:[^\]]+\]/g, '').trim()
        };
      },
      handler: async (params = {}, context = {}) => {
        const { keyword } = params;
        if (!keyword) return;

        const memories = await this.queryMemories(keyword, context);
        await this.storeNoteIfWorkflow(context, `查询记忆 "${keyword}"，找到 ${memories.length} 条相关记忆`, 'memory', true);
        if (memories.length > 0) {
          context.memoryResults = memories;
        }
        BotUtil.makeLog('info', `[${this.name}] 查询记忆 "${keyword}"，找到 ${memories.length} 条`, 'MemoryStream');
      },
      enabled: true
    });

    // 删除记忆
    this.registerFunction('delete_memory', {
      description: '删除长期记忆',
      prompt: `[删除记忆:index] - 根据序号删除指定的记忆`,
      parser: (text, context) => {
        const match = text.match(/\[删除记忆:(\d+)\]/);
        if (!match) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'delete_memory', params: { id: parseInt(match[1]) } }],
          cleanText: text.replace(/\[删除记忆:\d+\]/g, '').trim()
        };
      },
      handler: async (params = {}, context = {}) => {
        const { id } = params;
        if (!id) return;

        const success = await this.deleteMemory(id, context);
        await this.storeNoteIfWorkflow(context, success ? `已删除记忆 #${id}` : `删除记忆 #${id} 失败`, 'memory', true);
        BotUtil.makeLog('info', `[${this.name}] ${success ? '删除' : '删除失败'}记忆 #${id}`, 'MemoryStream');
      },
      enabled: true
    });

    // 列出记忆
    this.registerFunction('list_memories', {
      description: '列出所有记忆',
      prompt: `[列出记忆] - 列出所有保存的长期记忆`,
      parser: (text, context) => {
        if (!text.includes('[列出记忆]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'list_memories', params: {} }],
          cleanText: text.replace(/\[列出记忆\]/g, '').trim()
        };
      },
      handler: async (params = {}, context = {}) => {
        const memories = await this.listMemories(context);
        await this.storeNoteIfWorkflow(context, `列出所有记忆，共 ${memories.length} 条`, 'memory', true);
        BotUtil.makeLog('info', `[${this.name}] 列出记忆，共 ${memories.length} 条`, 'MemoryStream');
      },
      enabled: true
    });
  }

  /**
   * 获取用户ID（统一方法）
   */
  getUserId(context) {
    return context?.e?.user_id || context?.e?.user?.id || 'default';
  }

  /**
   * 获取场景（统一方法）
   */
  getScene(context) {
    return context?.scene || 'default';
  }

  /**
   * 保存记忆
   */
  async saveMemory(content, context) {
    const memoryId = Date.now();
    const userId = this.getUserId(context);
    const scene = this.getScene(context);
    
    const memory = {
      id: memoryId,
      content,
      userId,
      scene,
      timestamp: Date.now(),
      createdAt: new Date().toISOString()
    };

    this.memories.set(memoryId, memory);
    await this.saveMemoryToFile(memory);
    
    return memoryId;
  }

  /**
   * 查询记忆
   */
  async queryMemories(keyword, context) {
    const userId = this.getUserId(context);
    const scene = this.getScene(context);
    
    const results = [];
    for (const memory of this.memories.values()) {
      if (memory.userId === userId && memory.scene === scene) {
        if (memory.content.includes(keyword)) {
          results.push(memory);
        }
      }
    }
    
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 删除记忆
   */
  async deleteMemory(id, context) {
    const userId = this.getUserId(context);
    const memory = this.memories.get(id);
    
    if (!memory || memory.userId !== userId) {
      return false;
    }

    this.memories.delete(id);
    await this.deleteMemoryFile(id);
    
    return true;
  }

  /**
   * 列出记忆
   */
  async listMemories(context) {
    const userId = this.getUserId(context);
    const scene = this.getScene(context);
    
    const results = [];
    for (const memory of this.memories.values()) {
      if (memory.userId === userId && memory.scene === scene) {
        results.push(memory);
      }
    }
    
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 保存记忆到文件
   */
  async saveMemoryToFile(memory) {
    const userId = memory.userId;
    const scene = memory.scene;
    const memoryFile = path.join(this.memoryDir, `${userId}_${scene}.json`);
    
    try {
      let memories = [];
      try {
        const data = await fs.readFile(memoryFile, 'utf8');
        memories = JSON.parse(data);
      } catch {
        // 文件不存在，创建新数组
      }
      
      // 更新或添加记忆
      const index = memories.findIndex(m => m.id === memory.id);
      if (index >= 0) {
        memories[index] = memory;
      } else {
        memories.push(memory);
      }
      
      await fs.writeFile(memoryFile, JSON.stringify(memories, null, 2), 'utf8');
    } catch (error) {
      BotUtil.makeLog('error', `[${this.name}] 保存记忆到文件失败: ${error.message}`, 'MemoryStream');
    }
  }

  /**
   * 从文件删除记忆
   */
  async deleteMemoryFile(id) {
    // 遍历所有记忆文件，找到并删除对应的记忆
    try {
      const files = await fs.readdir(this.memoryDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const memoryFile = path.join(this.memoryDir, file);
          try {
            const data = await fs.readFile(memoryFile, 'utf8');
            const memories = JSON.parse(data);
            const filtered = memories.filter(m => m.id !== id);
            if (filtered.length !== memories.length) {
              await fs.writeFile(memoryFile, JSON.stringify(filtered, null, 2), 'utf8');
              break;
            }
          } catch {
            // 忽略错误
          }
        }
      }
    } catch (error) {
      BotUtil.makeLog('error', `[${this.name}] 从文件删除记忆失败: ${error.message}`, 'MemoryStream');
    }
  }

  /**
   * 加载记忆数据
   */
  async loadMemories() {
    try {
      const files = await fs.readdir(this.memoryDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const memoryFile = path.join(this.memoryDir, file);
          try {
            const data = await fs.readFile(memoryFile, 'utf8');
            const memories = JSON.parse(data);
            for (const memory of memories) {
              this.memories.set(memory.id, memory);
            }
          } catch {
            // 忽略错误
          }
        }
      }
    } catch {
      // 目录不存在，忽略
    }
  }

  /**
   * 获取用户场景的记忆（用于构建prompt）
   */
  async getMemoriesForContext(context) {
    const userId = this.getUserId(context);
    const scene = this.getScene(context);
    
    const memories = [];
    for (const memory of this.memories.values()) {
      if (memory.userId === userId && memory.scene === scene) {
        memories.push(memory);
      }
    }
    
    return memories.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10); // 最多返回10条
  }

  /**
   * 构建系统提示（辅助工作流，合并时不会被调用）
   */
  buildSystemPrompt(context) {
    return '记忆系统插件，为其他工作流提供记忆能力。';
  }

  /**
   * 获取记忆用于prompt展示（用于在主工作流的buildFunctionsPrompt中展示）
   */
  getMemoriesForPrompt(context) {
    const userId = this.getUserId(context);
    const scene = this.getScene(context);
    
    const memories = [];
    for (const memory of this.memories.values()) {
      if (memory.userId === userId && memory.scene === scene) {
        memories.push(memory);
      }
    }
    
    return memories.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5); // 最多展示5条
  }

  async buildChatContext(e, question) {
    return [];
  }

  async cleanup() {
    await super.cleanup();
  }
}
