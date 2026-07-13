import redisInit, { closeRedis, getRedisClient } from '../redis.js';
import BotUtil from '#utils/botutil.js';

class DatabaseManager {
  redis = null;
  initialized = false;

  async init() {
    if (this.initialized) {
      return { redis: !!this.redis };
    }

    const redisResult = await Promise.allSettled([redisInit()]).then((r) => r[0]);

    if (redisResult.status === 'fulfilled') {
      this.redis = redisResult.value ?? getRedisClient();
      BotUtil.makeLog('success', 'Redis 初始化成功', 'DatabaseManager');
    } else {
      const level = process.env.XRK_OPTIONAL_DB === '1' ? 'warn' : 'error';
      BotUtil.makeLog(level, `Redis 初始化失败: ${redisResult.reason.message}`, 'DatabaseManager');
    }

    this.initialized = true;
    const status = { redis: !!this.redis };

    if (!status.redis && process.env.XRK_OPTIONAL_DB !== '1') {
      throw new Error('Redis 不可用');
    }
    if (!status.redis) {
      BotUtil.makeLog('warn', 'XRK_OPTIONAL_DB=1：在无 Redis 连接下继续启动', 'DatabaseManager');
    }

    return status;
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
    await Promise.allSettled([closeRedis().catch(() => {})]);
    this.redis = null;
    this.initialized = false;
    BotUtil.makeLog('info', '数据库连接已关闭', 'DatabaseManager');
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
