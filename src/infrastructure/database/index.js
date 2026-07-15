import redisInit, { closeRedis, getRedisClient } from '../redis.js';
import RuntimeUtil from '#utils/runtime-util.js';

class DatabaseManager {
  redis = null;
  initialized = false;

  async init() {
    if (this.initialized) {
      return { redis: !!this.redis };
    }

    try {
      this.redis = (await redisInit()) ?? getRedisClient();
      RuntimeUtil.makeLog('success', 'Redis 初始化成功', 'DatabaseManager');
    } catch (err) {
      RuntimeUtil.makeLog('error', `Redis 初始化失败: ${err.message}`, 'DatabaseManager');
      throw err;
    }

    this.initialized = true;
    return { redis: !!this.redis };
  }

  getRedis() {
    return this.redis;
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
    await closeRedis().catch(() => {});
    this.redis = null;
    this.initialized = false;
    RuntimeUtil.makeLog('info', 'Redis 连接已关闭', 'DatabaseManager');
  }

  async getHealthStatus() {
    const redis = await this.checkRedis();
    return { redis };
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

export function getRedis() {
  return getDatabaseManager().getRedis();
}

export default getDatabaseManager;
