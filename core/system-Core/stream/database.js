import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';

/**
 * 知识库工作流插件（数据库）
 * 
 * 所有功能都通过 MCP 工具提供：
 * - query_knowledge（查询知识）
 * - list_knowledge（列出知识库）
 * - save_knowledge（保存知识）
 * - delete_knowledge（删除知识）
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
   */
  registerAllFunctions() {
    /**
     * 保存知识到知识库
     * 
     * @description 将知识保存到指定的知识库中。支持文本或JSON格式的内容，会自动生成embedding用于后续向量检索。
     * 
     * @param {string} db - 知识库名称（必填）
     * @param {string} content - 知识内容，支持文本或JSON格式（必填）
     * 
     * @returns {Object} 返回结果对象
     * @returns {boolean} returns.success - 是否成功
     * @returns {Object} returns.data - 成功时的数据对象
     * @returns {string} returns.data.db - 知识库名称
     * @returns {string} returns.data.message - 操作结果消息
     * @returns {string} returns.error - 失败时的错误信息
     * 
     * @example
     * // 保存文本知识
     * { db: "faq", content: "如何重置密码？点击登录页面的'忘记密码'链接" }
     * 
     * // 保存JSON知识
     * { db: "products", content: '{"name": "产品A", "price": 100}' }
     */
    this.registerMCPTool('save_knowledge', {
      description: '保存知识到知识库。支持文本或JSON格式，会自动生成embedding用于向量检索，可用于RAG。',
      inputSchema: {
        type: 'object',
        properties: {
          db: {
            type: 'string',
            description: '知识库名称（如果不存在会自动创建）'
          },
          content: {
            type: 'string',
            description: '知识内容。可以是纯文本（如："如何重置密码？点击登录页面的忘记密码链接"）或JSON格式（如：\'{"name": "产品A", "price": 100, "description": "..."}\'）。系统会自动识别格式并处理。'
          }
        },
        required: ['db', 'content']
      },
      handler: async (args = {}, _context = {}) => {
        const { db, content } = args;
        if (!db) return { success: false, error: '知识库名称不能为空' };
        if (!content) return { success: false, error: '知识内容不能为空' };

        await this.saveKnowledge(db, content);
        BotUtil.makeLog('info', `[${this.name}] 保存知识到知识库: ${db}`, 'DatabaseStream');
        
        return {
          success: true,
          data: { db, message: '知识保存成功' }
        };
      },
      enabled: true
    });

    /**
     * 查询知识库
     * 
     * @description 从指定知识库中查询知识，支持关键词搜索和向量检索（如果启用了embedding）。如果未指定关键词，返回所有知识。
     * 
     * @param {string} db - 知识库名称（必填）
     * @param {string} [keyword] - 搜索关键词（可选，不指定则返回所有知识）
     * 
     * @returns {Object} 返回结果对象
     * @returns {boolean} returns.success - 是否成功
     * @returns {Object} returns.data - 成功时的数据对象
     * @returns {string} returns.data.db - 知识库名称
     * @returns {string} returns.data.keyword - 搜索的关键词（如果指定）
     * @returns {Array} returns.data.results - 查询结果列表
     * @returns {number} returns.data.count - 结果数量
     * @returns {string} returns.error - 失败时的错误信息
     * 
     * @example
     * // 关键词搜索
     * { db: "faq", keyword: "密码" }
     * 
     * // 获取所有知识
     * { db: "faq" }
     */
    this.registerMCPTool('query_knowledge', {
      description: '从知识库查询知识。当需要从知识库中查找信息、检索FAQ、查找产品信息、搜索文档内容时使用此工具。支持关键词搜索和向量检索（如果启用了embedding），可以找到语义相关的内容。如果未指定关键词，返回知识库中的所有知识。',
      inputSchema: {
        type: 'object',
        properties: {
          db: {
            type: 'string',
            description: '知识库名称（必填）。要查询的知识库，例如："faq"、"products"、"docs"等。必须是一个已存在的知识库。'
          },
          keyword: {
            type: 'string',
            description: '搜索关键词（可选，支持语义搜索，不指定则返回所有知识）'
          }
        },
        required: ['db']
      },
      handler: async (args = {}, context = {}) => {
        const { db, keyword } = args;
        if (!db) return { success: false, error: '知识库名称不能为空' };

        const results = await this.queryKnowledge(db, keyword);
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

    /**
     * 列出所有知识库
     * 
     * @description 列出系统中所有可用的知识库名称。
     * 
     * @param {} 无需参数
     * 
     * @returns {Object} 返回结果对象
     * @returns {boolean} returns.success - 是否成功
     * @returns {Object} returns.data - 成功时的数据对象
     * @returns {Array} returns.data.databases - 知识库名称列表
     * @returns {number} returns.data.count - 知识库数量
     * 
     * @example
     * // 调用示例
     * {}
     * 
     * // 返回示例
     * {
     *   success: true,
     *   data: {
     *     databases: ["faq", "products", "docs"],
     *     count: 3
     *   }
     * }
     */
    this.registerMCPTool('list_knowledge', {
      description: '列出所有可用的知识库。当需要查看系统中有哪些知识库、了解可用的知识库名称时使用此工具。返回所有已创建的知识库名称列表。',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, _context = {}) => {
        const dbs = await this.listDatabases();
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

    /**
     * 删除知识
     * 
     * @description 从知识库中删除知识。支持按ID删除、按条件删除或删除所有知识。
     * 
     * @param {string} db - 知识库名称（必填）
     * @param {string} [condition] - 删除条件：知识ID（数字）、条件（key=value格式）或"*"（删除所有）
     * 
     * @returns {Object} 返回结果对象
     * @returns {boolean} returns.success - 是否成功
     * @returns {Object} returns.data - 成功时的数据对象
     * @returns {string} returns.data.db - 知识库名称
     * @returns {string} returns.data.condition - 使用的删除条件
     * @returns {number} returns.data.deletedCount - 删除的知识数量
     * @returns {string} returns.data.message - 操作结果消息
     * @returns {string} returns.error - 失败时的错误信息
     * 
     * @example
     * // 按ID删除
     * { db: "faq", condition: "1234567890" }
     * 
     * // 按条件删除
     * { db: "products", condition: "category=old" }
     * 
     * // 删除所有
     * { db: "faq", condition: "*" }
     */
    this.registerMCPTool('delete_knowledge', {
      description: '从知识库删除知识。当需要删除错误的知识、清理过时信息、清空知识库时使用此工具。支持按ID删除（精确删除）、按条件删除（key=value格式）或删除所有知识（condition="*"）。需要先通过 query_knowledge 获取知识ID。',
      inputSchema: {
        type: 'object',
        properties: {
          db: {
            type: 'string',
            description: '知识库名称'
          },
          condition: {
            type: 'string',
            description: '删除条件。可以是：1) 知识ID（数字字符串，如"1234567890"）精确删除一条知识；2) 条件表达式（key=value格式，如"category=old"）删除匹配条件的知识；3) "*" 删除知识库中的所有知识。'
          }
        },
        required: ['db']
      },
      handler: async (args = {}, _context = {}) => {
        const { db, condition } = args;
        if (!db) return { success: false, error: '知识库名称不能为空' };

        const count = await this.deleteKnowledge(db, condition || '*');
        
        return {
          success: true,
          data: {
            db,
            condition: condition || '*',
            deletedCount: count,
            message: `已删除 ${count} 条知识`
          }
        };
      },
      enabled: true
    });
  }

  /**
   * 保存知识（自动处理文本或JSON，并生成 embedding）
   */
  async saveKnowledge(db, content) {
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
    if (this.embeddingConfig.enabled) {
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
  async queryKnowledge(db, keyword) {
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

      // 向量检索结果已按相似度排序（由子服务端处理）

      return allResults.slice(0, maxResults);
    } catch (error) {
      BotUtil.makeLog('debug', `[${this.name}] 检索知识库失败: ${error.message}`, 'DatabaseStream');
      return [];
    }
  }

  /**
   * 列出所有知识库
   */
  async listDatabases() {
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
  async deleteKnowledge(db, condition) {
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
  buildSystemPrompt() {
    return '知识库工作流插件，为其他工作流提供知识存储和检索能力。';
  }

  /**
   * 同步获取知识库列表
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

  async buildChatContext() {
    return [];
  }

  async cleanup() {
    await super.cleanup();
  }
}
