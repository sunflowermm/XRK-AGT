import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';

/**
 * 知识库工作流插件（数据库）
 * 
 * 功能分类：
 * - MCP工具（返回JSON）：query_knowledge（查询知识）、list_knowledge（列出知识库）
 * - Call Function（执行操作）：save_knowledge（保存知识）、delete_knowledge（删除知识）
 * 
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
      embedding: { enabled: true }
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

  }

  /**
   * 注册所有知识库相关功能
   * 
   * MCP工具：query_knowledge, list_knowledge（返回JSON，不出现在prompt中）
   * Call Function：save_knowledge, delete_knowledge（出现在prompt中，供AI调用）
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

    // Call Function：保存知识（执行操作，不返回JSON）
    this.registerFunction('save_knowledge', {
      description: '保存知识到知识库',
      prompt: () => `[保存知识:knowledgeBase:content] - 保存知识到指定知识库，内容可以是文本或JSON，支持多行内容${getKnowledgePrompt()}`,
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
      handler: async (params = {}, context = {}) => {
        const { db, content } = params;
        if (!db || !content) return;

        await this.saveKnowledge(db, content, context);
        await this.storeNoteIfWorkflow(context, `已保存知识到知识库: ${db}`, 'database', true);
        BotUtil.makeLog('info', `[${this.name}] 保存知识到知识库: ${db}`, 'DatabaseStream');
      },
      enabled: true
    });

    // MCP工具：查询知识（返回JSON结果）
    this.registerMCPTool('query_knowledge', {
      description: '从知识库查询知识，支持关键词搜索',
      inputSchema: {
        type: 'object',
        properties: {
          db: {
            type: 'string',
            description: '知识库名称'
          },
          keyword: {
            type: 'string',
            description: '搜索关键词'
          }
        },
        required: ['db']
      },
      handler: async (args = {}, context = {}) => {
        const { db, keyword } = args;
        if (!db) {
          return { success: false, error: '知识库名称不能为空' };
        }

        const results = await this.queryKnowledge(db, keyword, context);
        
        // 在工作流中记录笔记

        if (context.stream) {
          context.stream.context = context.stream.context || {};
          context.stream.context.knowledgeResults = results;
        }

        BotUtil.makeLog('info', `[${this.name}] 查询知识库: ${db}，找到 ${results.length} 条`, 'DatabaseStream');

        return {
          success: true,
          data: {
            db,
            keyword: keyword || '*',
            results,
            count: results.length
          }
        };
      },
      enabled: true
    });

    // MCP工具：列出知识库（返回JSON结果）
    this.registerMCPTool('list_knowledge', {
      description: '列出所有可用的知识库',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (args = {}, context = {}) => {
        const dbs = await this.listDatabases(context);
        
        // 在工作流中记录笔记

        return {
          success: true,
          data: {
            databases: dbs,
            count: dbs.length
          }
        };
      },
      enabled: true
    });

    // Call Function：删除知识（执行操作，不返回JSON）
    this.registerFunction('delete_knowledge', {
      description: '从知识库删除知识',
      prompt: `[删除知识:knowledgeBase:condition] - 从指定知识库删除知识，支持ID或条件删除`,
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
      handler: async (params = {}, context = {}) => {
        const { db, condition } = params;
        if (!db) return;

        const count = await this.deleteKnowledge(db, condition, context);
        await this.storeNoteIfWorkflow(context, `从知识库 ${db} 删除了 ${count} 条知识`, 'database', true);
      },
      enabled: true
    });
  }

  /**
   * 保存知识（自动处理文本或JSON，并生成 embedding）
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

    // 如果启用 embedding，生成并缓存向量
    if (this.embeddingConfig.enabled && this.embeddingReady) {
      const textContent = typeof record.content === 'string' 
        ? record.content 
        : JSON.stringify(record);
      try {
        const embedding = await this.generateEmbedding(textContent);
        if (embedding && Array.isArray(embedding)) {
          record.embedding = embedding;
        }
      } catch (error) {
        BotUtil.makeLog('debug', `[${this.name}] 生成embedding失败，将异步生成: ${error.message}`, 'DatabaseStream');
        // 异步生成 embedding（不阻塞主流程）
        this.generateEmbeddingAsync(record, db, textContent).catch(() => {});
      }
    }
    
    records.push(record);
    await fs.writeFile(dbFile, JSON.stringify(records, null, 2), 'utf8');
    this.databases.set(db, records);
    
    BotUtil.makeLog('info', `[${this.name}] 保存知识到知识库: ${db}`, 'DatabaseStream');
  }

  /**
   * 查询知识（支持向量检索和关键词搜索）
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
    
    // 如果启用 embedding，使用向量检索
    if (this.embeddingConfig.enabled) {
      return await this.queryKnowledgeWithEmbedding(records, keyword, db);
    }
    
    // 否则使用关键词搜索
    return records.filter(record => {
      const content = JSON.stringify(record).toLowerCase();
      return content.includes(keyword.toLowerCase());
    });
  }

  /**
   * 使用向量检索知识库
   */
  async queryKnowledgeWithEmbedding(records, query, dbName = null) {
    if (!records || records.length === 0) return [];
    
    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      // 回退到关键词搜索
      return records.filter(record => {
        const content = JSON.stringify(record).toLowerCase();
        return content.includes(query.toLowerCase());
      });
    }

    // 为每条记录计算相似度
    const scored = [];
    for (const record of records) {
      const content = typeof record.content === 'string' 
        ? record.content 
        : JSON.stringify(record);
      
      // 如果记录已有 embedding，直接使用
      let recordEmbedding = record.embedding;
      if (!recordEmbedding || !Array.isArray(recordEmbedding)) {
        // 生成 embedding（不立即保存，避免频繁IO）
        recordEmbedding = await this.generateEmbedding(content);
        if (!recordEmbedding || !Array.isArray(recordEmbedding)) {
          continue; // 跳过无法生成 embedding 的记录
        }
        // 异步保存 embedding（不阻塞检索）
        record.embedding = recordEmbedding;
        if (dbName) {
          this.saveEmbeddingAsync(record, dbName).catch(() => {}); // 静默失败
        }
      }

      const similarity = this.cosineSimilarity(queryEmbedding, recordEmbedding);
      scored.push({ record, similarity });
    }

    // 按相似度排序并过滤
    const threshold = this.embeddingConfig.similarityThreshold ?? 0.3;
    return scored
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .map(item => item.record);
  }

  /**
   * 异步生成并保存 embedding（不阻塞主流程）
   */
  async generateEmbeddingAsync(record, db, textContent) {
    try {
      const embedding = await this.generateEmbedding(textContent);
      if (embedding && Array.isArray(embedding)) {
        record.embedding = embedding;
        await this.saveEmbeddingAsync(record, db);
      }
    } catch (error) {
      BotUtil.makeLog('debug', `[${this.name}] 异步生成embedding失败: ${error.message}`, 'DatabaseStream');
    }
  }

  /**
   * 异步保存 embedding（不阻塞主流程）
   */
  async saveEmbeddingAsync(record, db) {
    const dbFile = path.join(this.dbDir, `${db}.json`);
    try {
      const data = await fs.readFile(dbFile, 'utf8');
      const records = JSON.parse(data);
      const index = records.findIndex(r => r.id === record.id);
      if (index >= 0 && record.embedding) {
        records[index].embedding = record.embedding;
        await fs.writeFile(dbFile, JSON.stringify(records, null, 2), 'utf8');
        this.databases.set(db, records);
      }
    } catch (error) {
      BotUtil.makeLog('debug', `[${this.name}] 保存embedding失败: ${error.message}`, 'DatabaseStream');
    }
  }

  /**
   * 自动检索相关知识库内容（用于 RAG）
   */
  async retrieveKnowledgeContexts(query, maxResults = 5) {
    if (!query || !this.embeddingConfig.enabled) {
      return [];
    }

    try {
      const databases = await this.listDatabases({});
      if (databases.length === 0) return [];

      const allResults = [];
      
      // 从所有知识库检索
      for (const db of databases) {
        const results = await this.queryKnowledge(db, query, {});
        results.forEach(record => {
          const content = typeof record.content === 'string' 
            ? record.content 
            : JSON.stringify(record);
          allResults.push({
            source: `知识库:${db}`,
            content: content.substring(0, 200), // 限制长度
            record: record
          });
        });
      }

      // 如果使用向量检索，按相似度排序
      if (this.embeddingConfig.mode === 'remote') {
        const queryEmbedding = await this.generateEmbedding(query);
        if (queryEmbedding && Array.isArray(queryEmbedding)) {
          for (const result of allResults) {
            const recordEmbedding = result.record.embedding || 
              await this.generateEmbedding(result.content);
            if (recordEmbedding && Array.isArray(recordEmbedding)) {
              result.similarity = this.cosineSimilarity(queryEmbedding, recordEmbedding);
              if (!result.record.embedding) {
                result.record.embedding = recordEmbedding; // 缓存
              }
            }
          }
          allResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        }
      }

      return allResults.slice(0, maxResults);
    } catch (error) {
      BotUtil.makeLog('debug', `[${this.name}] 检索知识库失败: ${error.message}`, 'DatabaseStream');
      return [];
    }
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
