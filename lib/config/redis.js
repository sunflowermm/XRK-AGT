import cfg from './config.js'
import common from '../common/common.js'
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
    logger.info('Redis客户端已存在，返回现有实例')
    return globalClient
  }

  const redisUrl = buildRedisUrl(cfg.redis)
  const clientConfig = buildClientConfig(redisUrl)
  
  let client = createClient(clientConfig)
  let connected = false
  let retryCount = 0

  // 尝试连接Redis
  while (!connected && retryCount < REDIS_CONFIG.MAX_RETRIES) {
    try {
      logger.info(`正在连接Redis [尝试 ${retryCount + 1}/${REDIS_CONFIG.MAX_RETRIES}]: ${logger.blue(maskRedisUrl(redisUrl))}`)
      await client.connect()
      connected = true
      logger.info('✓ Redis连接成功')
    } catch (err) {
      retryCount++
      logger.warn(`✗ Redis连接失败 (${retryCount}/${REDIS_CONFIG.MAX_RETRIES}): ${err.message}`)

      if (retryCount < REDIS_CONFIG.MAX_RETRIES) {
        await attemptRedisStart(retryCount)
        client = createClient(clientConfig)
      } else {
        handleFinalConnectionFailure(err, cfg.redis.port)
      }
    }
  }

  // 注册事件监听器
  registerEventHandlers(client)
  
  // 启动健康检查
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
    const user = username || ''
    const pass = password ? `:${password}` : ''
    auth = `${user}${pass}@`
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
    logger.info(`Redis重连策略: 第${retries + 1}次重连将在${delay}ms后执行`)
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
  
  // 根据内存大小调整连接池
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
  
  logger.debug(`系统资源: CPU=${cpuCount}核, 内存=${memoryGB.toFixed(2)}GB, 连接池大小=${finalSize}`)
  
  return finalSize
}

/**
 * 尝试启动本地Redis服务（仅开发环境）
 * @param {number} retryCount - 当前重试次数
 */
async function attemptRedisStart(retryCount) {
  if (process.env.NODE_ENV === 'production') {
    logger.warn('生产环境不自动启动Redis服务，请确保Redis服务已运行')
    return
  }

  try {
    const archOptions = await getArchitectureOptions()
    const redisConfig = '--save 900 1 --save 300 10 --daemonize yes'
    const cmd = `redis-server ${redisConfig}${archOptions}`
    
    logger.info('尝试启动本地Redis服务...')
    const result = await execCommand(cmd)
    
    if (result.error) {
      logger.debug(`Redis启动命令执行: ${result.error.message}`)
    }
    
    const waitTime = 2000 + retryCount * 1000
    logger.info(`等待Redis服务启动 (${waitTime}ms)...`)
    await common.sleep(waitTime)
  } catch (err) {
    logger.debug(`启动Redis服务时出错: ${err.message}`)
  }
}

/**
 * 处理最终连接失败
 * @param {Error} error - 错误对象
 * @param {number} port - Redis端口
 */
function handleFinalConnectionFailure(error, port) {
  logger.error(`Redis连接失败: ${logger.red(error.message)}`)
  logger.error('请检查以下项目:')
  logger.error(`  1. Redis服务是否已启动`)
  logger.error(`  2. Redis配置是否正确 (config/config.yaml)`)
  logger.error(`  3. 端口 ${port} 是否被占用或被防火墙阻止`)
  logger.error(`  4. 网络连接是否正常`)
  
  if (process.env.NODE_ENV !== 'production') {
    const archOptions = getArchitectureOptions()
    logger.error(`\n手动启动命令: ${logger.blue(`redis-server --daemonize yes${archOptions}`)}`)
  }
  
  process.exit(1)
}

/**
 * 注册Redis事件监听器
 * @param {import('redis').RedisClientType} client - Redis客户端
 */
function registerEventHandlers(client) {
  // 错误事件
  client.on('error', async (err) => {
    logger.error(`Redis错误: ${logger.red(err.message)}`)
    
    // 避免重复重连
    if (client._isReconnecting) {
      return
    }
    
    client._isReconnecting = true
    
    try {
      if (!client.isOpen) {
        logger.info('尝试重新连接Redis...')
        await client.connect()
        logger.info('✓ Redis重新连接成功')
      }
    } catch (reconnectErr) {
      logger.error(`Redis重连失败: ${reconnectErr.message}`)
    } finally {
      client._isReconnecting = false
    }
  })

  // 就绪事件
  client.on('ready', () => {
    logger.info('✓ Redis就绪，可以接收命令')
  })

  // 重连事件
  client.on('reconnecting', () => {
    logger.info('→ Redis正在重新连接...')
  })

  // 连接关闭事件
  client.on('end', () => {
    logger.warn('✗ Redis连接已关闭')
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
        logger.debug('Redis健康检查: OK')
      }
    } catch (err) {
      logger.warn(`Redis健康检查失败: ${err.message}`)
    }
  }, REDIS_CONFIG.HEALTH_CHECK_INTERVAL)
}

/**
 * 获取系统架构特定的Redis选项
 * @returns {Promise<string>} 架构特定选项
 */
async function getArchitectureOptions() {
  if (process.platform === 'win32') {
    return ''
  }
  
  try {
    const { stdout: arch } = await execCommand('uname -m')
    const archType = arch.trim()
    
    // ARM64架构特殊处理
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
    logger.debug(`检查系统架构失败: ${err.message}`)
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
  if (globalClient && globalClient.isOpen) {
    try {
      await globalClient.quit()
      logger.info('Redis连接已优雅关闭')
    } catch (err) {
      logger.error(`关闭Redis连接失败: ${err.message}`)
      await globalClient.disconnect()
    }
  }
}

/**
 * 获取Redis客户端实例
 * @returns {import('redis').RedisClientType|null} Redis客户端实例
 */
export function getRedisClient() {
  return globalClient
}