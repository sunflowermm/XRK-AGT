/**
 * Runtime 数据库门面：Redis（热）+ SQLite（嵌入式落盘）
 *
 * Mongo / Postgres / Qdrant 等可选存储不在此初始化，见 persistence-registry。
 */
import redisInit, { closeRedis, getRedisClient } from '../redis.js';
import sqliteInit, {
  closeSqlite,
  getSqliteClient,
  checkSqlite,
  withSqliteTransaction,
  getSqlitePath,
  sqlitePrepare,
  sqliteKvSet,
  sqliteKvGet,
  sqliteKvDel,
} from '../sqlite.js';

export {
  PERSISTENCE_POLICY,
  registerPersistenceProvider,
  unregisterPersistenceProvider,
  clearPersistenceProviders,
  listPersistenceProviders,
  probePersistenceProviders,
} from './persistence-registry.js';

export {
  withSqliteTransaction,
  getSqlitePath,
  checkSqlite,
  sqlitePrepare,
  sqliteKvSet,
  sqliteKvGet,
  sqliteKvDel,
};

class DatabaseManager {
  redis = null;
  sqlite = null;
  initialized = false;

  /**
   * 启动期初始化（fail-fast）
   * @returns {Promise<{ redis: boolean, sqlite: boolean }>}
   */
  async init() {
    if (this.initialized) {
      return { redis: !!this.redis, sqlite: !!this.sqlite };
    }
    this.redis = (await redisInit()) ?? getRedisClient();
    this.sqlite = sqliteInit();
    this.initialized = true;
    return { redis: !!this.redis, sqlite: !!this.sqlite };
  }

  /** @returns {import('redis').RedisClientType|null} */
  getRedis() {
    return this.redis;
  }

  /** @returns {import('node:sqlite').DatabaseSync|null} */
  getSqlite() {
    return this.sqlite;
  }

  /** @returns {Promise<boolean>} */
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

  /** @returns {boolean} */
  checkSqlite() {
    return checkSqlite();
  }

  async close() {
    await closeRedis().catch(() => {});
    closeSqlite();
    this.redis = null;
    this.sqlite = null;
    this.initialized = false;
  }
}

/** @type {DatabaseManager|null} */
let instance = null;

/** @returns {DatabaseManager} */
export function getDatabaseManager() {
  if (!instance) instance = new DatabaseManager();
  return instance;
}

/** @returns {Promise<DatabaseManager>} */
export async function initDatabases() {
  const manager = getDatabaseManager();
  await manager.init();
  return manager;
}

export async function closeDatabases() {
  await getDatabaseManager().close();
}

/** @returns {import('redis').RedisClientType|null} */
export function getRedis() {
  return getDatabaseManager().getRedis();
}

/** @returns {import('node:sqlite').DatabaseSync|null} */
export function getSqlite() {
  return getDatabaseManager().getSqlite() ?? getSqliteClient();
}

export default getDatabaseManager;
