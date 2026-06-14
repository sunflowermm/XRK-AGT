import mongodbInit, { closeMongodb } from '../mongodb.js';
import redisInit, { closeRedis, getRedisClient } from '../redis.js';
import BotUtil from '#utils/botutil.js';
import { getRuntimeGlobal } from '#utils/runtime-globals.js';

class DatabaseManager {
  mongodb = null;
  mongodbDb = null;
  redis = null;
  initialized = false;

  async init() {
    if (this.initialized) {
      return { mongodb: !!this.mongodb, redis: !!this.redis };
    }

    const [mongodbResult, redisResult] = await Promise.allSettled([
      mongodbInit(),
      redisInit()
    ]);

    if (mongodbResult.status === 'fulfilled') {
      this.mongodbDb = mongodbResult.value;
      this.mongodb = getRuntimeGlobal('mongodb');
      BotUtil.makeLog('success', 'MongoDB 初始化成功', 'DatabaseManager');
    } else {
      const level = process.env.XRK_OPTIONAL_DB === '1' ? 'warn' : 'error';
      BotUtil.makeLog(level, `MongoDB 初始化失败: ${mongodbResult.reason.message}`, 'DatabaseManager');
    }

    if (redisResult.status === 'fulfilled') {
      this.redis = redisResult.value ?? getRedisClient();
      BotUtil.makeLog('success', 'Redis 初始化成功', 'DatabaseManager');
    } else {
      const level = process.env.XRK_OPTIONAL_DB === '1' ? 'warn' : 'error';
      BotUtil.makeLog(level, `Redis 初始化失败: ${redisResult.reason.message}`, 'DatabaseManager');
    }

    this.initialized = true;
    const status = { mongodb: !!this.mongodb, redis: !!this.redis };

    if (!status.mongodb && !status.redis && process.env.XRK_OPTIONAL_DB !== '1') {
      throw new Error('MongoDB 与 Redis 均不可用');
    }
    if (!status.mongodb && !status.redis) {
      BotUtil.makeLog('warn', 'XRK_OPTIONAL_DB=1：在无数据库连接下继续启动', 'DatabaseManager');
    }

    return status;
  }

  getMongoClient() {
    return this.mongodb;
  }

  getMongoDb() {
    return this.mongodbDb;
  }

  getRedis() {
    return this.redis;
  }

  async checkMongoDB() {
    const db = this.mongodbDb;
    if (!db) return false;
    try {
      await db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  async checkRedis() {
    const redis = this.redis;
    if (!redis?.isOpen) return false;
    try {
      await redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  async close() {
    await Promise.allSettled([
      closeMongodb().catch(() => {}),
      closeRedis().catch(() => {})
    ]);
    this.mongodb = null;
    this.mongodbDb = null;
    this.redis = null;
    this.initialized = false;
    BotUtil.makeLog('info', '数据库连接已关闭', 'DatabaseManager');
  }

  async getHealthStatus() {
    const [mongodb, redis] = await Promise.all([
      this.checkMongoDB(),
      this.checkRedis()
    ]);
    return { mongodb, redis };
  }
}

let instance = null;

export function getDatabaseManager() {
  if (!instance) instance = new DatabaseManager();
  return instance;
}

export async function initDatabases() {
  const manager = getDatabaseManager();
  await manager.init();
  return manager;
}

export async function closeDatabases() {
  await getDatabaseManager().close();
}

export function getMongoClient() {
  return getDatabaseManager().getMongoClient();
}

export function getMongoDb() {
  return getDatabaseManager().getMongoDb();
}

export function getRedis() {
  return getDatabaseManager().getRedis();
}

export default getDatabaseManager;
