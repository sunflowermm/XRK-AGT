import { existsSync } from 'node:fs'

/**
 * 休眠函数
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 制作转发消息
 * @param {Object} e - 消息事件
 * @param {Array|string} [msg=[]] - 消息数组
 * @param {string} [dec=''] - 转发描述
 * @returns {*} 转发消息对象
 */
export const makeForwardMsg = (e, msg = [], dec = '') => {
  const messages = Array.isArray(msg) ? msg : [msg]
  const forwardMsg = dec 
    ? [{ message: dec }, ...messages.map(message => ({ message }))] 
    : messages.map(message => ({ message }))

  return e?.group?.makeForwardMsg?.(forwardMsg) 
    ?? e?.friend?.makeForwardMsg?.(forwardMsg) 
    ?? Bot.makeForwardMsg?.(forwardMsg)
}

/**
 * 检测是否为 Docker 环境
 * @returns {boolean} 是否为 Docker 环境
 */
export const isDockerEnvironment = () => {
  return process.env.DOCKER_CONTAINER === '1' || existsSync('/.dockerenv')
}

/**
 * 规范化主机地址（移除引号，处理 Docker 服务名）
 * @param {string} host - 原始主机地址
 * @param {string} serviceName - Docker 服务名（如 'redis'）
 * @returns {string} 规范化后的主机地址
 */
export const normalizeHost = (host, serviceName) => {
  const hostStr = String(host).replace(/^["']|["']$/g, '')
  if (!isDockerEnvironment() && hostStr === serviceName) {
    return '127.0.0.1'
  }
  return hostStr
}

export default {
  sleep,
  makeForwardMsg,
  isDockerEnvironment,
  normalizeHost
}
