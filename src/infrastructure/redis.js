import cfg from './config/config.js'
import common, { normalizeHost } from '#utils/common.js'
import { normalizeError } from '#utils/normalize-error.js'
import {
  connectWithRetry,
  detectArm64,
  execCommandResult
} from '#utils/db-connect-utils.js'
import BotUtil from '#utils/botutil.js'
import os from 'node:os'
import { createClient } from 'redis'

/** @type {import('redis').RedisClientType | null} */
let globalClient = null

const REDIS_CONFIG = {
  MAX_RETRIES: 3,
  CONNECT_TIMEOUT: 10000,
  MAX_COMMAND_QUEUE: 5000,
  MIN_POOL_SIZE: 3,
  MAX_POOL_SIZE: 50,
  RECONNECT_BASE_DELAY: 1000,
  RECONNECT_MAX_DELAY: 30000,
  HEALTH_CHECK_INTERVAL: 30000
}

export default async function redisInit() {
  if (globalClient?.isOpen) return globalClient

  const fastStart = process.env.XRK_FAST_START === '1'
  const maxRetries = fastStart ? 1 : REDIS_CONFIG.MAX_RETRIES
  const redisUrl = buildRedisUrl(cfg.redis)
  const clientConfig = buildClientConfig(redisUrl, fastStart)

  const client = await connectWithRetry({
    label: 'Redis',
    maxRetries,
    fastStart,
    connectionUrl: redisUrl,
    createClient: () => createClient(clientConfig),
    onBeforeRetry: attemptRedisStart,
    devHint: '手动启动: redis-server --daemonize yes'
  })

  registerEventHandlers(client)
  startHealthCheck(client)

  // @ts-ignore - Redis 客户端类型兼容性问题
  globalClient = client
  // @ts-ignore - 全局变量赋值
  global.redis = client
  return client
}

function buildRedisUrl(redisConfig) {
  const username = redisConfig?.username || ''
  const password = redisConfig?.password || ''
  const host = normalizeHost(redisConfig?.host || '127.0.0.1', 'redis')
  const port = redisConfig?.port || 6379
  const db = redisConfig?.db || 0
  const auth = (username || password) ? `${username}${password ? `:${password}` : ''}@` : ''
  return `redis://${auth}${host}:${port}/${db}`
}

function buildClientConfig(redisUrl, fastStart = false) {
  const options = cfg.redis?.options || {}
  const connectTimeout = fastStart
    ? 2000
    : (options.connectTimeout ?? REDIS_CONFIG.CONNECT_TIMEOUT)
  return {
    url: redisUrl,
    socket: {
      reconnectStrategy: createReconnectStrategy(),
      connectTimeout
    },
    connectionPoolSize: getOptimalPoolSize(),
    commandsQueueMaxLength: REDIS_CONFIG.MAX_COMMAND_QUEUE
  }
}

function createReconnectStrategy() {
  return (/** @type {number} */ retries) => {
    const delay = Math.min(
      Math.pow(2, retries) * REDIS_CONFIG.RECONNECT_BASE_DELAY,
      REDIS_CONFIG.RECONNECT_MAX_DELAY
    )
    return delay
  }
}

function getOptimalPoolSize() {
  const cpuCount = os.cpus().length
  const memoryGB = os.totalmem() / (1024 ** 3)
  const basePoolSize = Math.ceil(cpuCount * 3)

  const memoryLimit = memoryGB < 2 ? 5 : memoryGB < 4 ? 10 : memoryGB < 8 ? 20 : Infinity
  const poolSize = Math.min(basePoolSize, memoryLimit)

  const finalSize = Math.max(
    REDIS_CONFIG.MIN_POOL_SIZE,
    Math.min(poolSize, REDIS_CONFIG.MAX_POOL_SIZE)
  )

  BotUtil.makeLog('debug', `系统资源: CPU=${cpuCount}核, 内存=${memoryGB.toFixed(2)}GB, 连接池大小=${finalSize}`, 'Redis')
  return finalSize
}

async function attemptRedisStart(retryCount) {
  if (process.env.NODE_ENV === 'production') return

  try {
    const archOptions = await getArchitectureOptions()
    const cmd = `redis-server --save 900 1 --save 300 10 --daemonize yes${archOptions}`

    BotUtil.makeLog('info', '尝试启动本地服务...', 'Redis')
    await execCommandResult(cmd)
    await common.sleep(2000 + retryCount * 1000)
  } catch (err) {
    const error = normalizeError(err)
    BotUtil.makeLog('debug', `启动失败: ${error.message}`, 'Redis')
  }
}

function registerEventHandlers(client) {
  client.on('error', async (/** @type {any} */ err) => {
    const error = normalizeError(err)
    BotUtil.makeLog('error', error.message, 'Redis')

    if (!client._reconnectState) {
      client._reconnectState = { isReconnecting: false }
    }

    if (client._reconnectState.isReconnecting || client.isOpen) return

    client._reconnectState.isReconnecting = true
    try {
      BotUtil.makeLog('info', '尝试重新连接...', 'Redis')
      await client.connect()
      BotUtil.makeLog('success', '重新连接成功', 'Redis')
    } catch (reconnectErr) {
      const reconnectError = normalizeError(reconnectErr)
      BotUtil.makeLog('error', `重连失败: ${reconnectError.message}`, 'Redis')
    } finally {
      client._reconnectState.isReconnecting = false
    }
  })

  client.on('ready', () => BotUtil.makeLog('info', '就绪', 'Redis'))
  client.on('reconnecting', () => BotUtil.makeLog('info', '正在重新连接...', 'Redis'))
  client.on('end', () => BotUtil.makeLog('warn', '连接已关闭', 'Redis'))
}

function startHealthCheck(client) {
  setInterval(async () => {
    if (!client.isOpen) return
    try {
      await client.ping()
    } catch (err) {
      const error = normalizeError(err)
      BotUtil.makeLog('warn', `健康检查失败: ${error.message}`, 'Redis')
    }
  }, REDIS_CONFIG.HEALTH_CHECK_INTERVAL)
}

async function getArchitectureOptions() {
  if (!(await detectArm64())) return ''

  try {
    const { stdout: versionOutput } = await execCommandResult('redis-server -v')
    const versionMatch = versionOutput.match(/v=(\d+)\.(\d+)/)
    if (!versionMatch?.[1] || !versionMatch?.[2]) return ''

    const majorVer = parseInt(versionMatch[1], 10)
    const minorVer = parseInt(versionMatch[2], 10)

    if (majorVer > 6 || (majorVer === 6 && minorVer >= 0)) {
      return ' --ignore-warnings ARM64-COW-BUG'
    }
  } catch (err) {
    const error = normalizeError(err)
    BotUtil.makeLog('debug', `检查系统架构失败: ${error.message}`, 'Redis')
  }
  return ''
}

export async function closeRedis() {
  if (!globalClient?.isOpen) return

  globalClient.removeAllListeners('end')

  try {
    await globalClient.quit()
  } catch {
    try {
      await globalClient.disconnect()
    } catch {}
  }
}

export function getRedisClient() {
  return globalClient
}
