import cfg from './config/config.js'
import common from '#utils/common.js'
import BotUtil from '#utils/botutil.js'
import fs from 'node:fs'
import path from 'node:path'
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
  let retryCount = 0

  while (retryCount < MONGODB_CONFIG.MAX_RETRIES) {
    try {
      BotUtil.makeLog('info', `连接中 [${retryCount + 1}/${MONGODB_CONFIG.MAX_RETRIES}]: ${maskMongoUrl(mongoUrl)}`, 'MongoDB')
      await client.connect()
      BotUtil.makeLog('success', '连接成功', 'MongoDB')
      break
    } catch (err) {
      retryCount++
      BotUtil.makeLog('warn', `连接失败 [${retryCount}/${MONGODB_CONFIG.MAX_RETRIES}]: ${err.message}`, 'MongoDB')

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
    const user = encodeURIComponent(username)
    const pass = password ? `:${encodeURIComponent(password)}` : ''
    auth = `${user}${pass}@`
  }
  
  const queryParams = new URLSearchParams()
  const optionKeys = ['maxPoolSize', 'minPoolSize', 'connectTimeoutMS', 'serverSelectionTimeoutMS']
  optionKeys.forEach(key => {
    if (options[key]) queryParams.set(key, options[key])
  })
  
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
  if (process.env.NODE_ENV === 'production') return

  try {
    const dbPath = path.join(process.cwd(), 'data', 'mongodb')
    const logPath = path.join(dbPath, 'mongodb.log')
    
    // 确保目录存在（recursive: true 会自动处理已存在的情况）
    fs.mkdirSync(dbPath, { recursive: true })
    
    const archOptions = await getArchitectureOptions()
    const forkFlag = process.platform === 'win32' ? '' : '--fork'
    const cmd = `mongod --dbpath "${dbPath}" --logpath "${logPath}" ${forkFlag} ${archOptions}`.trim()
    
    BotUtil.makeLog('info', '尝试启动本地服务...', 'MongoDB')
    await execCommand(cmd)
    
    const waitTime = 3000 + retryCount * 1000
    await common.sleep(waitTime)
  } catch (err) {
    BotUtil.makeLog('debug', `启动失败: ${err.message}`, 'MongoDB')
  }
}

function handleFinalConnectionFailure(error, port) {
  BotUtil.makeLog('error', `连接失败: ${error.message}`, 'MongoDB')
  BotUtil.makeLog('error', '请检查: 1)服务是否启动 2)配置是否正确 3)端口是否可用 4)网络是否正常', 'MongoDB')
  
  if (process.env.NODE_ENV !== 'production') {
    const dbPath = path.join(process.cwd(), 'data', 'mongodb')
    const forkFlag = process.platform === 'win32' ? '' : '--fork'
    BotUtil.makeLog('error', `手动启动: mongod --dbpath "${dbPath}" ${forkFlag}`.trim(), 'MongoDB')
  }
  
  process.exit(1)
}

function registerEventHandlers(client) {
  client.on('serverHeartbeatFailed', (event) => {
    BotUtil.makeLog('warn', `心跳失败: ${event.failure?.message || '未知错误'}`, 'MongoDB')
  })
}

function startHealthCheck(client, db) {
  setInterval(async () => {
    try {
      await db.admin().ping()
    } catch (err) {
      BotUtil.makeLog('warn', `健康检查失败: ${err.message}`, 'MongoDB')
    }
  }, MONGODB_CONFIG.HEALTH_CHECK_INTERVAL)
}

async function getArchitectureOptions() {
  if (process.platform === 'win32') return ''
  
  try {
    const { stdout: arch } = await execCommand('uname -m')
    const archType = arch.trim()
    if (archType.includes('aarch64') || archType.includes('arm64')) {
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
  if (!globalClient) return

  try {
    await globalClient.close()
    BotUtil.makeLog('info', '连接已关闭', 'MongoDB')
    globalClient = null
    globalDb = null
  } catch (err) {
    BotUtil.makeLog('error', `关闭失败: ${err.message}`, 'MongoDB')
  }
}


