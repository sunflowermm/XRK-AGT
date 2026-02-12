/**
 * 统一数据库管理器
 * 
 * 提供统一的数据库访问接口，管理MongoDB和Redis连接
 * 替代直接使用全局变量的方式
 */

import mongodbInit, { closeMongodb } from '../mongodb.js'
import redisInit, { closeRedis, getRedisClient } from '../redis.js'
import BotUtil from '#utils/botutil.js'

/**
 * 数据库管理器类
 */
class DatabaseManager {
  constructor() {
    this.mongodb = null
    this.mongodbDb = null
    this.redis = null
    this.initialized = false
  }

  /**
   * 初始化所有数据库连接
   * @returns {Promise<{mongodb: boolean, redis: boolean}>}
   */
  async init() {
    if (this.initialized) {
      return {
        mongodb: !!this.mongodb,
        redis: !!this.redis
      }
    }

    try {
      // 并行初始化MongoDB和Redis
      const [mongodbResult, redisResult] = await Promise.allSettled([
        mongodbInit(),
        redisInit()
      ])

      // 处理MongoDB初始化结果
      if (mongodbResult.status === 'fulfilled') {
        this.mongodbDb = mongodbResult.value
        // 从全局变量获取客户端（保持兼容性）
        this.mongodb = global.mongodb
        BotUtil.makeLog('success', 'MongoDB 初始化成功', 'DatabaseManager')
      } else {
        BotUtil.makeLog('error', `MongoDB 初始化失败: ${mongodbResult.reason?.message}`, 'DatabaseManager')
      }

      // 处理Redis初始化结果
      if (redisResult.status === 'fulfilled') {
        this.redis = redisResult.value || getRedisClient()
        BotUtil.makeLog('success', 'Redis 初始化成功', 'DatabaseManager')
      } else {
        BotUtil.makeLog('error', `Redis 初始化失败: ${redisResult.reason?.message}`, 'DatabaseManager')
      }

      this.initialized = true

      return {
        mongodb: !!this.mongodb,
        redis: !!this.redis
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      BotUtil.makeLog('error', `数据库初始化异常: ${err.message}`, 'DatabaseManager')
      throw err
    }
  }

  /**
   * 获取MongoDB客户端
   * @returns {import('mongodb').MongoClient | null}
   */
  getMongoClient() {
    return this.mongodb || global.mongodb || null
  }

  /**
   * 获取MongoDB数据库实例
   * @returns {import('mongodb').Db | null}
   */
  getMongoDb() {
    return this.mongodbDb || global.mongodbDb || null
  }

  /**
   * 获取Redis客户端
   * @returns {import('redis').RedisClientType | null}
   */
  getRedis() {
    return this.redis || global.redis || null
  }

  /**
   * 检查MongoDB连接状态
   * @returns {Promise<boolean>}
   */
  async checkMongoDB() {
    try {
      const db = this.getMongoDb()
      if (!db) return false
      await db.admin().ping()
      return true
    } catch {
      return false
    }
  }

  /**
   * 检查Redis连接状态
   * @returns {Promise<boolean>}
   */
  async checkRedis() {
    try {
      const redis = this.getRedis()
      if (!redis || !redis.isOpen) return false
      await redis.ping()
      return true
    } catch {
      return false
    }
  }

  /**
   * 关闭所有数据库连接
   * @returns {Promise<void>}
   */
  async close() {
    const promises = []
    
    if (this.mongodb || global.mongodb) {
      promises.push(closeMongodb().catch(() => {}))
    }
    
    if (this.redis || global.redis) {
      promises.push(closeRedis().catch(() => {}))
    }

    await Promise.allSettled(promises)
    
    this.mongodb = null
    this.mongodbDb = null
    this.redis = null
    this.initialized = false

    BotUtil.makeLog('info', '所有数据库连接已关闭', 'DatabaseManager')
  }

  /**
   * 获取数据库健康状态
   * @returns {Promise<{mongodb: boolean, redis: boolean}>}
   */
  async getHealthStatus() {
    const [mongodb, redis] = await Promise.all([
      this.checkMongoDB(),
      this.checkRedis()
    ])

    return { mongodb, redis }
  }
}

// 单例实例
let instance = null

/**
 * 获取数据库管理器实例
 * @returns {DatabaseManager}
 */
export function getDatabaseManager() {
  if (!instance) {
    instance = new DatabaseManager()
  }
  return instance
}

/**
 * 初始化数据库（便捷函数）
 * @returns {Promise<DatabaseManager>}
 */
export async function initDatabases() {
  const manager = getDatabaseManager()
  await manager.init()
  return manager
}

/**
 * 关闭所有数据库连接（便捷函数）
 * @returns {Promise<void>}
 */
export async function closeDatabases() {
  const manager = getDatabaseManager()
  await manager.close()
}

// 导出便捷访问函数
export function getMongoClient() {
  return getDatabaseManager().getMongoClient()
}

export function getMongoDb() {
  return getDatabaseManager().getMongoDb()
}

export function getRedis() {
  return getDatabaseManager().getRedis()
}

export default getDatabaseManager
