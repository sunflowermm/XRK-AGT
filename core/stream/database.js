import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';

/**
 * 知识库工作流插件（数据库）
 * 作为智能体的重要组成部分，提供知识存储、检索、管理功能
 * 支持快速调用，简化参数，便于AI和开发者使用
 */
export default class DatabaseStream extends AIStream {
  constructor() {
    super({
      name: 'database',
      description: '知识库工作流插件',
      version: '2.0.0',
      author: 'XRK',
      priority: 1,
      config: {
        enabled: true,
        temperature: 0.7,
        maxTokens: 2000
      },
      embedding: { enabled: false }
    });
    
    // 知识库存储目录
    this.dbDir = path.join(os.homedir(), '.xrk', 'knowledge');
    this.databases = new Map(); // 内存中的数据库缓存
  }

  async init() {
    await super.init();
    
    // 确保知识库目录存在
    await fs.mkdir(this.dbDir, { recursive: true });

    // 注册知识库相关功能（简化调用方式）
    this.registerAllFunctions();

    BotUtil.makeLog('info', `[${this.name}] 知识库工作流已初始化`, 'DatabaseStream');
  }

  /**
   * 注册所有知识库相关功能
   * 优化：prompt字段动态包含可用知识库列表
   */
  registerAllFunctions() {
    // 动态获取可用知识库列表
    const getKnowledgePrompt = () => {
      const databases = this.getDatabasesSync();
      const dbList = databases.length > 0 
        ? `\n可用知识库：${databases.join('、')}`
        : '\n提示：使用[保存知识:知识库名:内容]可创建新知识库';
      return dbList;
    };

    // 保存知识（优化：支持多行内容）
    this.registerFunction('save_knowledge', {
      description: '保存知识到知识库',
      prompt: () => `[保存知识:知识库名:内容] - 保存知识到指定知识库，内容可以是文本或JSON，支持多行内容${getKnowledgePrompt()}`,
      parser: (text, context) => {
        const match = text.match(/\[保存知识:([^:]+):([^\]]+)\]/);
        if (!match) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'save_knowledge', params: { db: match[1], content: match[2] } }],
          cleanText: text.replace(/\[保存知识:[^\]]+\]/g, '').trim()
        };
      },
      handler: async (params, context) => {
        const { db, content } = params || {};
        if (!db || !content) return;

        await this.saveKnowledge(db, content, context);
        if (context.workflowId) {
          await this.storeNote(context.workflowId, `已保存知识到知识库: ${db}`, 'database', true);
        }
        BotUtil.makeLog('info', `[${this.name}] 保存知识到知识库: ${db}`, 'DatabaseStream');
      },
      enabled: true
    });

    // 查询知识（简化版：支持关键词和条件查询）
    this.registerFunction('query_knowledge', {
      description: '从知识库查询知识',
      prompt: () => `[查询知识:知识库名:关键词] - 从指定知识库查询知识，支持关键词搜索${getKnowledgePrompt()}`,
      parser: (text, context) => {
        const match = text.match(/\[查询知识:([^:]+):([^\]]+)\]/);
        if (!match) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'query_knowledge', params: { db: match[1], keyword: match[2] } }],
          cleanText: text.replace(/\[查询知识:[^\]]+\]/g, '').trim()
        };
      },
      handler: async (params, context) => {
        const { db, keyword } = params || {};
        if (!db) return;

        const results = await this.queryKnowledge(db, keyword, context);
        if (context.workflowId) {
          await this.storeNote(context.workflowId, `从知识库 ${db} 查询到 ${results.length} 条知识`, 'database', true);
        }
        // 将查询结果注入到context中，供后续步骤使用
        if (context && results.length > 0) {
          context.knowledgeResults = results;
        }
        BotUtil.makeLog('info', `[${this.name}] 查询知识库: ${db}，找到 ${results.length} 条`, 'DatabaseStream');
      },
      enabled: true
    });

    // 列出知识库
    this.registerFunction('list_knowledge', {
      description: '列出所有知识库',
      prompt: () => `[列出知识库] - 列出所有可用的知识库${getKnowledgePrompt()}`,
      parser: (text, context) => {
        if (!text.includes('[列出知识库]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'list_knowledge', params: {} }],
          cleanText: text.replace(/\[列出知识库\]/g, '').trim()
        };
      },
      handler: async (params, context) => {
        const dbs = await this.listDatabases(context);
        if (context.workflowId) {
          await this.storeNote(context.workflowId, `列出知识库，共 ${dbs.length} 个`, 'database', true);
        }
      },
      enabled: true
    });

    // 删除知识（简化版：支持ID或条件删除）
    this.registerFunction('delete_knowledge', {
      description: '从知识库删除知识',
      prompt: `[删除知识:知识库名:ID或条件] - 从指定知识库删除知识，支持ID或条件删除`,
      parser: (text, context) => {
        const match = text.match(/\[删除知识:([^:]+):([^\]]+)\]/);
        if (!match) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'delete_knowledge', params: { db: match[1], condition: match[2] } }],
          cleanText: text.replace(/\[删除知识:[^\]]+\]/g, '').trim()
        };
      },
      handler: async (params, context) => {
        const { db, condition } = params || {};
        if (!db) return;

        const count = await this.deleteKnowledge(db, condition, context);
        if (context.workflowId) {
          await this.storeNote(context.workflowId, `从知识库 ${db} 删除了 ${count} 条知识`, 'database', true);
        }
      },
      enabled: true
    });
  }

  /**
   * 保存知识（简化版：自动处理文本或JSON）
   */
  async saveKnowledge(db, content, context) {
    const dbFile = path.join(this.dbDir, `${db}.json`);
    
    let records = [];
    try {
      const data = await fs.readFile(dbFile, 'utf8');
      records = JSON.parse(data);
    } catch {
      // 文件不存在，创建新数组
    }
    
    // 自动判断是文本还是JSON
    let knowledgeData;
    try {
      knowledgeData = JSON.parse(content);
    } catch {
      // 不是JSON，作为文本处理
      knowledgeData = { content, type: 'text' };
    }
    
    const record = {
      id: Date.now(),
      ...knowledgeData,
      createdAt: new Date().toISOString()
    };
    
    records.push(record);
    await fs.writeFile(dbFile, JSON.stringify(records, null, 2), 'utf8');
    this.databases.set(db, records);
    
    BotUtil.makeLog('info', `[${this.name}] 保存知识到知识库: ${db}`, 'DatabaseStream');
  }

  /**
   * 查询知识（简化版：支持关键词搜索）
   */
  async queryKnowledge(db, keyword, context) {
    const dbFile = path.join(this.dbDir, `${db}.json`);
    
    let records = [];
    try {
      const data = await fs.readFile(dbFile, 'utf8');
      records = JSON.parse(data);
    } catch {
      return [];
    }
    
    if (!keyword || keyword === '*') {
      return records;
    }
    
    // 支持关键词搜索（在content字段中搜索）
    return records.filter(record => {
      const content = JSON.stringify(record).toLowerCase();
      return content.includes(keyword.toLowerCase());
    });
  }

  /**
   * 列出所有知识库
   */
  async listDatabases(context) {
    try {
      const files = await fs.readdir(this.dbDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * 删除知识（简化版：支持ID或条件）
   */
  async deleteKnowledge(db, condition, context) {
    const dbFile = path.join(this.dbDir, `${db}.json`);
    
    let records = [];
    try {
      const data = await fs.readFile(dbFile, 'utf8');
      records = JSON.parse(data);
    } catch {
      return 0;
    }
    
    if (!condition || condition === '*') {
      records = [];
    } else {
      // 判断是ID还是条件
      const id = parseInt(condition);
      if (!isNaN(id)) {
        // 按ID删除
        const beforeCount = records.length;
        records = records.filter(record => record.id !== id);
        const deletedCount = beforeCount - records.length;
        
        await fs.writeFile(dbFile, JSON.stringify(records, null, 2), 'utf8');
        this.databases.set(db, records);
        return deletedCount;
      } else {
        // 按条件删除（支持 key=value 格式）
        const [key, value] = condition.split('=').map(s => s.trim());
        const beforeCount = records.length;
        records = records.filter(record => record[key] !== value);
        const deletedCount = beforeCount - records.length;
        
        await fs.writeFile(dbFile, JSON.stringify(records, null, 2), 'utf8');
        this.databases.set(db, records);
        return deletedCount;
      }
    }
    
    await fs.writeFile(dbFile, JSON.stringify(records, null, 2), 'utf8');
    this.databases.set(db, records);
    return records.length;
  }

  /**
   * 获取知识库内容（用于构建prompt）
   */
  async getKnowledgeForContext(db, limit = 10) {
    const dbFile = path.join(this.dbDir, `${db}.json`);
    
    try {
      const data = await fs.readFile(dbFile, 'utf8');
      const records = JSON.parse(data);
      return records.slice(-limit); // 返回最新的N条
    } catch {
      return [];
    }
  }

  /**
   * 构建系统提示（辅助工作流，合并时不会被调用）
   */
  buildSystemPrompt(context) {
    return '知识库工作流插件，为其他工作流提供知识存储和检索能力。';
  }

  /**
   * 同步获取知识库列表（用于在主工作流的buildFunctionsPrompt中展示）
   */
  getDatabasesSync() {
    try {
      const files = fsSync.readdirSync(this.dbDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch {
      return [];
    }
  }

  async buildChatContext(e, question) {
    return [];
  }

  async cleanup() {
    await super.cleanup();
  }
}
