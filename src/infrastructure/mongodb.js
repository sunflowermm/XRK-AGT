import cfg from './config/config.js'
import common, { normalizeHost } from '#utils/common.js'
import BotUtil from '#utils/botutil.js'
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { MongoClient } from 'mongodb'

/** @type {import('mongodb').MongoClient | null} */
let globalClient = null
/** @type {import('mongodb').Db | null} */
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

  const fastStart = process.env.XRK_FAST_START === '1'
  const maxRetries = fastStart ? 1 : MONGODB_CONFIG.MAX_RETRIES
  const mongoUrl = buildMongoUrl(cfg.mongodb)
  const clientOptions = buildClientOptions(fastStart)
  let client = new MongoClient(mongoUrl, clientOptions)
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      BotUtil.makeLog('info', `连接中 [${retryCount + 1}/${maxRetries}]: ${maskMongoUrl(mongoUrl)}`, 'MongoDB')
      await client.connect()
      BotUtil.makeLog('success', '连接成功', 'MongoDB')
      break
    } catch (err) {
      retryCount++
      const error = err instanceof Error ? err : new Error(String(err))
      BotUtil.makeLog('warn', `连接失败 [${retryCount}/${maxRetries}]: ${error.message}`, 'MongoDB')

      if (retryCount < maxRetries) {
        if (!fastStart) await attemptMongoStart(retryCount)
        client = new MongoClient(mongoUrl, clientOptions)
      } else {
        handleFinalConnectionFailure(error)
      }
    }
  }

  const db = client.db(cfg.mongodb.database || 'xrk_agt')
  registerEventHandlers(client)
  startHealthCheck(client, db)

  globalClient = client
  globalDb = db
  // @ts-ignore - 全局变量赋值
  global.mongodb = client
  // @ts-ignore - 全局变量赋值
  global.mongodbDb = db
  
  return db
}

function buildMongoUrl(mongoConfig) {
  const username = mongoConfig?.username || ''
  const password = mongoConfig?.password || ''
  const host = normalizeHost(mongoConfig?.host || '127.0.0.1', 'mongodb')
  const port = mongoConfig?.port || 27017
  const database = mongoConfig?.database || 'xrk_agt'
  const options = mongoConfig?.options || {}
  
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

function buildClientOptions(fastStart = false) {
  const options = cfg.mongodb?.options || {}
  const connectTimeout = fastStart ? 2000 : MONGODB_CONFIG.CONNECT_TIMEOUT
  return {
    maxPoolSize: options.maxPoolSize ?? MONGODB_CONFIG.MAX_POOL_SIZE,
    minPoolSize: options.minPoolSize ?? MONGODB_CONFIG.MIN_POOL_SIZE,
    connectTimeoutMS: options.connectTimeoutMS ?? connectTimeout,
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? connectTimeout,
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
    const error = err instanceof Error ? err : new Error(String(err))
    BotUtil.makeLog('debug', `启动失败: ${error.message}`, 'MongoDB')
  }
}

function handleFinalConnectionFailure(error) {
  BotUtil.makeLog('error', `连接失败: ${error.message}`, 'MongoDB')
  BotUtil.makeLog('error', '请检查: 1)服务是否启动 2)配置是否正确 3)端口是否可用 4)网络是否正常', 'MongoDB')
  
  if (process.env.NODE_ENV !== 'production') {
    const dbPath = path.join(process.cwd(), 'data', 'mongodb')
    const forkFlag = process.platform === 'win32' ? '' : '--fork'
    BotUtil.makeLog('error', `手动启动: mongod --dbpath "${dbPath}" ${forkFlag}`.trim(), 'MongoDB')
  }

  if (process.env.XRK_OPTIONAL_DB === '1') {
    throw error instanceof Error ? error : new Error(String(error))
  }

  process.exit(1)
}

function registerEventHandlers(client) {
  client.on('serverHeartbeatFailed', (/** @type {any} */ event) => {
    const message = event?.failure?.message || '未知错误'
    BotUtil.makeLog('warn', `心跳失败: ${message}`, 'MongoDB')
  })
}

function startHealthCheck(client, db) {
  setInterval(async () => {
    try {
      await db.admin().ping()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      BotUtil.makeLog('warn', `健康检查失败: ${error.message}`, 'MongoDB')
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
        stdout: (stdout || '').toString(),
        stderr: (stderr || '').toString()
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
    const error = err instanceof Error ? err : new Error(String(err))
    BotUtil.makeLog('error', `关闭失败: ${error.message}`, 'MongoDB')
  }
}

