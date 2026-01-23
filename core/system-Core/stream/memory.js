import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import MemoryManager from '#infrastructure/aistream/memory-manager.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

/**
 * 记忆系统工作流插件
 * 
 * 功能分类：
 * - MCP工具（返回JSON）：query_memory（查询记忆）、list_memories（列出记忆）
 * - Call Function（执行操作）：save_memory（保存记忆）、delete_memory（删除记忆）
 * 
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
    
    // 确保记忆目录存在
    await fs.mkdir(this.memoryDir, { recursive: true });

    // 注册记忆相关功能
    this.registerAllFunctions();
    
    // 加载记忆数据
    await this.loadMemories();

  }

  /**
   * 注册所有记忆相关功能
   * 
   * MCP工具：query_memory, list_memories（返回JSON，不出现在prompt中）
   * Call Function：save_memory, delete_memory（出现在prompt中，供AI调用）
   */
  registerAllFunctions() {

    // Call Function：保存长期记忆（执行操作，不返回JSON）
    this.registerFunction('save_memory', {
      description: '保存长期记忆',
      prompt: `[长期记忆:content] - 保存一条长期记忆，内容会被持久化存储`,
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

    // MCP工具：查询记忆（返回JSON结果）
    this.registerMCPTool('query_memory', {
      description: '根据关键词查询相关记忆，返回记忆列表',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '搜索关键词'
          }
        },
        required: ['keyword']
      },
      handler: async (args = {}, context = {}) => {
        const { keyword } = args;
        if (!keyword) {
          return { success: false, error: '关键词不能为空' };
        }

        const memories = await this.queryMemories(keyword, context);
        
        // 在工作流中记录笔记

        if (context.stream) {
          context.stream.context = context.stream.context || {};
          context.stream.context.memoryResults = memories;
        }

        BotUtil.makeLog('info', `[${this.name}] 查询记忆 "${keyword}"，找到 ${memories.length} 条`, 'MemoryStream');

        return {
          success: true,
          data: {
            keyword,
            memories,
            count: memories.length
          }
        };
      },
      enabled: true
    });

    // Call Function：删除记忆（执行操作，不返回JSON）
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

    // MCP工具：列出记忆（返回JSON结果）
    this.registerMCPTool('list_memories', {
      description: '列出所有保存的长期记忆',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (args = {}, context = {}) => {
        const memories = await this.listMemories(context);
        
        // 在工作流中记录笔记

        BotUtil.makeLog('info', `[${this.name}] 列出记忆，共 ${memories.length} 条`, 'MemoryStream');

        return {
          success: true,
          data: {
            memories,
            count: memories.length
          }
        };
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
    const userId = this.getUserId(context);
    
    const memoryId = await MemoryManager.addLongTermMemory(userId, {
      content,
      type: 'fact',
      importance: 0.7,
      metadata: {
        scene: this.getScene(context),
        source: this.name
      }
    });

    const memory = {
      id: memoryId,
      content,
      userId,
      scene: this.getScene(context),
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
    
    const memories = await MemoryManager.searchLongTermMemories(userId, keyword, 10);
    
    const scene = this.getScene(context);
    const results = memories
      .filter(m => m.metadata?.scene === scene || !scene)
      .map(m => ({
        id: m.id,
        content: m.content,
        userId: m.userId,
        scene: m.metadata?.scene || 'default',
        timestamp: m.timestamp,
        createdAt: new Date(m.timestamp).toISOString()
      }));
    
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

    MemoryManager.deleteLongTermMemory(userId, id);
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
    
    const memories = await MemoryManager.searchLongTermMemories(userId, '', 10);
    
    return memories
      .filter(m => m.metadata?.scene === scene || !scene)
      .map(m => ({
        id: m.id,
        content: m.content,
        userId: m.userId,
        scene: m.metadata?.scene || 'default',
        timestamp: m.timestamp
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 构建系统提示（辅助工作流，合并时不会被调用）
   */
  buildSystemPrompt(context) {
    return '记忆系统插件，为其他工作流提供记忆能力。';
  }

  /**
   * 获取记忆用于prompt展示
   * 注意：此方法用于在主工作流中展示记忆信息，不用于MCP工具
   */
  async getMemoriesForPrompt(context) {
    const userId = this.getUserId(context);
    const scene = this.getScene(context);
    
    const shortTerm = MemoryManager.getShortTermMemories(userId, 5);
    const longTerm = await MemoryManager.searchLongTermMemories(userId, '', 5);
    
    return [
      ...shortTerm.map(m => ({
        id: m.id,
        content: m.content,
        timestamp: m.timestamp
      })),
      ...longTerm
        .filter(m => m.metadata?.scene === scene || !scene)
        .map(m => ({
          id: m.id,
          content: m.content,
          timestamp: m.timestamp
        }))
    ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  }

  async buildChatContext(e, question) {
    return [];
  }

  async cleanup() {
    await super.cleanup();
  }
}
