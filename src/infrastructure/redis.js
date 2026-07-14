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
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { access } from 'node:fs/promises'
import { createClient } from 'redis'
import { setRuntimeGlobal } from '#utils/runtime-globals.js'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ENSURE_REDIS_CMD = path.join(PROJECT_ROOT, 'scripts', 'ensure-redis.cmd')

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
    devHint: process.platform === 'win32'
      ? '手动启动: net start Memurai / net start Redis  或 scripts\\ensure-redis.cmd'
      : '手动启动: redis-server --daemonize yes'
  })

  registerEventHandlers(client)
  startHealthCheck(client)

  // @ts-ignore - Redis 客户端类型兼容性问题
  globalClient = client
  setRuntimeGlobal('redis', client)
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
    BotUtil.makeLog('info', '尝试启动本地服务...', 'Redis')
    if (process.platform === 'win32') {
      await startRedisOnWindows()
    } else {
      const archOptions = await getArchitectureOptions()
      await execCommandResult(
        `redis-server --save 900 1 --save 300 10 --daemonize yes${archOptions}`
      )
    }
    await common.sleep(1500 + retryCount * 1000)
  } catch (err) {
    const error = normalizeError(err)
    BotUtil.makeLog('debug', `启动失败: ${error.message}`, 'Redis')
  }
}

/** Windows：复用 scripts/ensure-redis.cmd（Memurai / MSI Redis / redis-server）。 */
async function startRedisOnWindows() {
  try {
    await access(ENSURE_REDIS_CMD)
  } catch {
    throw new Error(`缺少 ${ENSURE_REDIS_CMD}（勿将 ensure-redis.cmd 从仓中忽略）`)
  }
  const result = await execCommandResult(`"${ENSURE_REDIS_CMD}"`)
  const out = `${result.stdout}${result.stderr}`
  if (result.error || !out.includes('127.0.0.1:6379 OK')) {
    throw result.error || new Error(out.trim() || 'ensure-redis 失败')
  }
}

let healthCheckTimer = null

function registerEventHandlers(client) {
  // 勿在 error 里再手动 connect：与 socket reconnectStrategy 双重重连会打架刷 console
  client.on('error', (/** @type {any} */ err) => {
    BotUtil.makeLog('warn', normalizeError(err).message, 'Redis')
  })
  client.on('ready', () => BotUtil.makeLog('debug', '就绪', 'Redis'))
  client.on('reconnecting', () => BotUtil.makeLog('debug', '正在重新连接...', 'Redis'))
  client.on('end', () => BotUtil.makeLog('warn', '连接已关闭', 'Redis'))
}

function startHealthCheck(client) {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
  healthCheckTimer = setInterval(async () => {
    if (!client.isOpen) return
    try {
      await client.ping()
    } catch (err) {
      BotUtil.makeLog('debug', `健康检查失败: ${normalizeError(err).message}`, 'Redis')
    }
  }, REDIS_CONFIG.HEALTH_CHECK_INTERVAL)
  healthCheckTimer.unref?.()
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
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
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
