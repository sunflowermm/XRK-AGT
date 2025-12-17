import cfg from './config/config.js'
import common from '#utils/common.js'
import { exec } from 'node:child_process'
import { MongoClient } from 'mongodb'

let globalClient = null
let globalDb = null

const MONGODB_CONFIG = {
  MAX_RETRIES: 3,
  CONNECT_TIMEOUT: 10000,
  MAX_POOL_SIZE: 50,
  MIN_POOL_SIZE: 3,
  HEALTH_CHECK_INTERVAL: 30000
}

export default async function mongodbInit() {
  if (globalClient && globalDb) {
    return globalDb
  }

  const mongoUrl = buildMongoUrl(cfg.mongodb)
  const clientOptions = buildClientOptions()
  
  let client = new MongoClient(mongoUrl, clientOptions)
  let connected = false
  let retryCount = 0

  while (!connected && retryCount < MONGODB_CONFIG.MAX_RETRIES) {
    try {
      logger.info(`[MongoDB] 连接中 [${retryCount + 1}/${MONGODB_CONFIG.MAX_RETRIES}]: ${maskMongoUrl(mongoUrl)}`)
      await client.connect()
      connected = true
      logger.info('[MongoDB] 连接成功')
    } catch (err) {
      retryCount++
      logger.warn(`[MongoDB] 连接失败 [${retryCount}/${MONGODB_CONFIG.MAX_RETRIES}]: ${err.message}`)

      if (retryCount < MONGODB_CONFIG.MAX_RETRIES) {
        await attemptMongoStart(retryCount)
        client = new MongoClient(mongoUrl, clientOptions)
      } else {
        handleFinalConnectionFailure(err, cfg.mongodb.port)
      }
    }
  }

  const db = client.db(cfg.mongodb.database || 'xrk_agt')
  registerEventHandlers(client)
  startHealthCheck(client, db)

  globalClient = client
  globalDb = db
  global.mongodb = client
  global.mongodbDb = db
  
  return db
}

function buildMongoUrl(mongoConfig) {
  const { username = '', password = '', host, port, database, options = {} } = mongoConfig
  
  let auth = ''
  if (username || password) {
    const user = encodeURIComponent(username || '')
    const pass = password ? `:${encodeURIComponent(password)}` : ''
    auth = `${user}${pass}@`
  }
  
  const queryParams = new URLSearchParams()
  if (options.maxPoolSize) queryParams.set('maxPoolSize', options.maxPoolSize)
  if (options.minPoolSize) queryParams.set('minPoolSize', options.minPoolSize)
  if (options.connectTimeoutMS) queryParams.set('connectTimeoutMS', options.connectTimeoutMS)
  if (options.serverSelectionTimeoutMS) queryParams.set('serverSelectionTimeoutMS', options.serverSelectionTimeoutMS)
  
  const queryString = queryParams.toString()
  const query = queryString ? `?${queryString}` : ''
  
  return `mongodb://${auth}${host}:${port}/${database || 'xrk_agt'}${query}`
}

function buildClientOptions() {
  return {
    maxPoolSize: MONGODB_CONFIG.MAX_POOL_SIZE,
    minPoolSize: MONGODB_CONFIG.MIN_POOL_SIZE,
    connectTimeoutMS: MONGODB_CONFIG.CONNECT_TIMEOUT,
    serverSelectionTimeoutMS: MONGODB_CONFIG.CONNECT_TIMEOUT,
    socketTimeoutMS: 45000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    retryReads: true
  }
}

async function attemptMongoStart(retryCount) {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  try {
    const archOptions = await getArchitectureOptions()
    const mongoConfig = '--dbpath ./data/mongodb --logpath ./data/mongodb/mongodb.log --fork'
    const cmd = `mongod ${mongoConfig}${archOptions}`
    
    logger.info('[MongoDB] 尝试启动本地服务...')
    await execCommand(cmd)
    
    const waitTime = 3000 + retryCount * 1000
    await common.sleep(waitTime)
  } catch (err) {
    logger.debug(`[MongoDB] 启动失败: ${err.message}`)
  }
}

function handleFinalConnectionFailure(error, port) {
  logger.error(`[MongoDB] 连接失败: ${error.message}`)
  logger.error('[MongoDB] 请检查: 1)服务是否启动 2)配置是否正确 3)端口是否可用 4)网络是否正常')
  
  if (process.env.NODE_ENV !== 'production') {
    logger.error(`[MongoDB] 手动启动: mongod --dbpath ./data/mongodb --fork`)
  }
  
  process.exit(1)
}

function registerEventHandlers(client) {
  client.on('connectionPoolClosed', () => {
    logger.warn('[MongoDB] 连接池已关闭')
  })

  client.on('serverHeartbeatFailed', (event) => {
    logger.warn(`[MongoDB] 心跳失败: ${event.failure?.message || '未知错误'}`)
  })
}

function startHealthCheck(client, db) {
  setInterval(async () => {
    try {
      await db.admin().ping()
    } catch (err) {
      logger.warn(`[MongoDB] 健康检查失败: ${err.message}`)
    }
  }, MONGODB_CONFIG.HEALTH_CHECK_INTERVAL)
}

async function getArchitectureOptions() {
  if (process.platform === 'win32') return ''
  
  try {
    const { stdout: arch } = await execCommand('uname -m')
    if (arch.trim().includes('aarch64') || arch.trim().includes('arm64')) {
      return ' --nojournal'
    }
  } catch {}
  
  return ''
}

function execCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve({
        error,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || ''
      })
    })
  })
}

function maskMongoUrl(url) {
  if (!url) {
    return url
  }
  return url.replace(/:([^@:]+)@/, ':******@')
}

export async function closeMongodb() {
  if (globalClient) {
    try {
      await globalClient.close()
      logger.info('[MongoDB] 连接已关闭')
      globalClient = null
      globalDb = null
    } catch (err) {
      logger.error(`[MongoDB] 关闭失败: ${err.message}`)
    }
  }
}

