import cfg from './config/config.js'
import common from '#utils/common.js'
import BotUtil from '#utils/botutil.js'
import { exec } from 'node:child_process'
import os from 'node:os'
import { createClient } from 'redis'

// Redis客户端全局实例
let globalClient = null

/**
 * Redis配置常量
 */
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

/**
 * 初始化Redis客户端
 * @returns {Promise<import('redis').RedisClientType>} Redis客户端实例
 */
export default async function redisInit() {
  if (globalClient && globalClient.isOpen) {
    return globalClient
  }

  const redisUrl = buildRedisUrl(cfg.redis)
  const clientConfig = buildClientConfig(redisUrl)
  let client = createClient(clientConfig)
  let retryCount = 0

  while (retryCount < REDIS_CONFIG.MAX_RETRIES) {
    try {
      BotUtil.makeLog('info', `连接中 [${retryCount + 1}/${REDIS_CONFIG.MAX_RETRIES}]: ${maskRedisUrl(redisUrl)}`, 'Redis')
      await client.connect()
      BotUtil.makeLog('success', '连接成功', 'Redis')
      break
    } catch (err) {
      retryCount++
      BotUtil.makeLog('warn', `连接失败 [${retryCount}/${REDIS_CONFIG.MAX_RETRIES}]: ${err.message}`, 'Redis')

      if (retryCount < REDIS_CONFIG.MAX_RETRIES) {
        await attemptRedisStart(retryCount)
        client = createClient(clientConfig)
      } else {
        handleFinalConnectionFailure(err, cfg.redis.port)
      }
    }
  }

  registerEventHandlers(client)
  startHealthCheck(client)

  globalClient = client
  global.redis = client
  
  return client
}

/**
 * 构建Redis连接URL
 * @param {Object} redisConfig - Redis配置对象
 * @returns {string} Redis连接URL
 */
function buildRedisUrl(redisConfig) {
  const { username = '', password = '', host, port, db } = redisConfig
  
  let auth = ''
  if (username || password) {
    const pass = password ? `:${password}` : ''
    auth = `${username}${pass}@`
  }
  
  return `redis://${auth}${host}:${port}/${db}`
}

/**
 * 构建Redis客户端配置
 * @param {string} redisUrl - Redis连接URL
 * @returns {Object} 客户端配置对象
 */
function buildClientConfig(redisUrl) {
  return {
    url: redisUrl,
    socket: {
      reconnectStrategy: createReconnectStrategy(),
      connectTimeout: REDIS_CONFIG.CONNECT_TIMEOUT
    },
    connectionPoolSize: getOptimalPoolSize(),
    commandsQueueMaxLength: REDIS_CONFIG.MAX_COMMAND_QUEUE
  }
}

/**
 * 创建重连策略
 * @returns {Function} 重连策略函数
 */
function createReconnectStrategy() {
  return (retries) => {
    const delay = Math.min(
      Math.pow(2, retries) * REDIS_CONFIG.RECONNECT_BASE_DELAY,
      REDIS_CONFIG.RECONNECT_MAX_DELAY
    )
    BotUtil.makeLog('debug', `Redis重连策略: 第${retries + 1}次重连将在${delay}ms后执行`, 'Redis')
    return delay
  }
}

/**
 * 根据系统资源计算最佳连接池大小
 * @returns {number} 推荐的连接池大小
 */
function getOptimalPoolSize() {
  const cpuCount = os.cpus().length
  const memoryGB = os.totalmem() / (1024 ** 3)
  
  let poolSize = Math.ceil(cpuCount * 3)
  
  if (memoryGB < 2) {
    poolSize = Math.min(poolSize, 5)
  } else if (memoryGB < 4) {
    poolSize = Math.min(poolSize, 10)
  } else if (memoryGB < 8) {
    poolSize = Math.min(poolSize, 20)
  }
  
  const finalSize = Math.max(
    REDIS_CONFIG.MIN_POOL_SIZE,
    Math.min(poolSize, REDIS_CONFIG.MAX_POOL_SIZE)
  )
  
  BotUtil.makeLog('debug', `系统资源: CPU=${cpuCount}核, 内存=${memoryGB.toFixed(2)}GB, 连接池大小=${finalSize}`, 'Redis')
  
  return finalSize
}

/**
 * 尝试启动本地Redis服务（仅开发环境）
 * @param {number} retryCount - 当前重试次数
 */
async function attemptRedisStart(retryCount) {
  if (process.env.NODE_ENV === 'production') return

  try {
    const archOptions = await getArchitectureOptions()
    const redisConfig = '--save 900 1 --save 300 10 --daemonize yes'
    const cmd = `redis-server ${redisConfig}${archOptions}`
    
    BotUtil.makeLog('info', '尝试启动本地服务...', 'Redis')
    await execCommand(cmd)
    
    const waitTime = 2000 + retryCount * 1000
    await common.sleep(waitTime)
  } catch (err) {
    BotUtil.makeLog('debug', `启动失败: ${err.message}`, 'Redis')
  }
}

/**
 * 处理最终连接失败
 * @param {Error} error - 错误对象
 * @param {number} port - Redis端口
 */
function handleFinalConnectionFailure(error, port) {
  BotUtil.makeLog('error', `连接失败: ${error.message}`, 'Redis')
  BotUtil.makeLog('error', '请检查: 1)服务是否启动 2)配置是否正确 3)端口是否可用 4)网络是否正常', 'Redis')
  
  if (process.env.NODE_ENV !== 'production') {
    BotUtil.makeLog('error', '手动启动: redis-server --daemonize yes', 'Redis')
  }
  
  process.exit(1)
}

/**
 * 注册Redis事件监听器
 * @param {import('redis').RedisClientType} client - Redis客户端
 */
function registerEventHandlers(client) {
  client.on('error', async (err) => {
    BotUtil.makeLog('error', err.message, 'Redis')
    
    if (client._isReconnecting) return
    
    client._isReconnecting = true
    
    try {
      if (!client.isOpen) {
        BotUtil.makeLog('info', '尝试重新连接...', 'Redis')
        await client.connect()
        BotUtil.makeLog('success', '重新连接成功', 'Redis')
      }
    } catch (reconnectErr) {
      BotUtil.makeLog('error', `重连失败: ${reconnectErr.message}`, 'Redis')
    } finally {
      client._isReconnecting = false
    }
  })

  client.on('ready', () => {
    BotUtil.makeLog('info', '就绪', 'Redis')
  })

  client.on('reconnecting', () => {
    BotUtil.makeLog('info', '正在重新连接...', 'Redis')
  })

  client.on('end', () => {
    BotUtil.makeLog('warn', '连接已关闭', 'Redis')
  })
}

/**
 * 启动Redis健康检查
 * @param {import('redis').RedisClientType} client - Redis客户端
 */
function startHealthCheck(client) {
  setInterval(async () => {
    try {
      if (client.isOpen) {
        await client.ping()
      }
    } catch (err) {
      BotUtil.makeLog('warn', `健康检查失败: ${err.message}`, 'Redis')
    }
  }, REDIS_CONFIG.HEALTH_CHECK_INTERVAL)
}

/**
 * 获取系统架构特定的Redis选项
 * @returns {Promise<string>} 架构特定选项
 */
async function getArchitectureOptions() {
  if (process.platform === 'win32') return ''
  
  try {
    const { stdout: arch } = await execCommand('uname -m')
    const archType = arch.trim()
    
    if (archType.includes('aarch64') || archType.includes('arm64')) {
      const { stdout: versionOutput } = await execCommand('redis-server -v')
      const versionMatch = versionOutput.match(/v=(\d+)\.(\d+)/)
      
      if (versionMatch) {
        const [, major, minor] = versionMatch
        const majorVer = parseInt(major, 10)
        const minorVer = parseInt(minor, 10)
        
        if (majorVer > 6 || (majorVer === 6 && minorVer >= 0)) {
          return ' --ignore-warnings ARM64-COW-BUG'
        }
      }
    }
  } catch (err) {
    BotUtil.makeLog('debug', `检查系统架构失败: ${err.message}`, 'Redis')
  }
  
  return ''
}

/**
 * 执行Shell命令
 * @param {string} cmd - 要执行的命令
 * @returns {Promise<{error: Error|null, stdout: string, stderr: string}>} 命令执行结果
 */
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

/**
 * 掩码Redis URL中的敏感信息
 * @param {string} url - Redis连接URL
 * @returns {string} 掩码后的URL
 */
function maskRedisUrl(url) {
  if (!url) {
    return url
  }
  return url.replace(/:([^@:]+)@/, ':******@')
}

/**
 * 优雅关闭Redis连接
 * @returns {Promise<void>}
 */
export async function closeRedis() {
  if (!globalClient || !globalClient.isOpen) return

  try {
    await globalClient.quit()
    BotUtil.makeLog('info', '连接已关闭', 'Redis')
  } catch (err) {
    BotUtil.makeLog('error', `关闭失败: ${err.message}`, 'Redis')
    await globalClient.disconnect()
  }
}

/**
 * 获取Redis客户端实例
 * @returns {import('redis').RedisClientType|null} Redis客户端实例
 */
export function getRedisClient() {
  return globalClient
}