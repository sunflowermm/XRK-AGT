import { pipeline } from 'node:stream/promises'
import fetch from 'node-fetch'
import fs from 'node:fs/promises'
import path from 'node:path'
import BotUtil from './botutil.js'

/**
 * 发送私聊消息，仅给好友发送
 * @param {string|number} userId - QQ号
 * @param {string} msg - 消息内容
 * @param {string} [uin=Bot.uin] - 指定bot发送
 * @returns {Promise<undefined|*>} 发送结果
 */
export const replyPrivate = async (userId, msg, uin = Bot.uin) => {
  const targetId = Number(userId)
  if (!targetId || !Bot?.fl?.get) return

  const friend = Bot.fl.get(targetId)
  if (!friend) return

  logger?.mark?.(`发送好友消息[${friend.nickname}](${targetId})`)
  try {
    return await Bot[uin].pickUser(targetId).sendMsg(msg)
  } catch (err) {
    logger?.mark?.(err)
    return undefined
  }
}

/**
 * 休眠函数
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 下载保存文件
 * @param {string} fileUrl - 下载地址
 * @param {string} savePath - 保存路径
 * @param {Object} [param={}] - 请求参数
 * @returns {Promise<boolean>} 是否成功
 */
export const downFile = async (fileUrl, savePath, param = {}) => {
  try {
    await BotUtil.mkdir(path.dirname(savePath))
    logger?.debug?.(`[下载文件] ${fileUrl}`)
    const response = await fetch(fileUrl, param)
    const { createWriteStream } = await import('node:fs')
    await pipeline(response.body, createWriteStream(savePath))
    return true
  } catch (err) {
    logger?.error?.(`下载文件错误：${err}`)
    return false
  }
}

/**
 * 制作转发消息
 * @param {Object} e - 消息事件
 * @param {Array|string} [msg=[]] - 消息数组
 * @param {string} [dec=''] - 转发描述
 * @param {Array} [nm=[]] - 未使用参数（保持兼容性）
 * @param {boolean} [msgsscr=false] - 未使用参数（保持兼容性）
 * @returns {*} 转发消息对象
 */
export const makeForwardMsg = (e, msg = [], dec = '', nm = [], msgsscr = false) => {
  const messages = Array.isArray(msg) ? msg : [msg]
  const forwardMsg = dec 
    ? [{ message: dec }, ...messages.map(message => ({ message }))] 
    : messages.map(message => ({ message }))

  return e?.group?.makeForwardMsg?.(forwardMsg) 
    ?? e?.friend?.makeForwardMsg?.(forwardMsg) 
    ?? Bot.makeForwardMsg?.(forwardMsg)
}

// 保持向后兼容
export default { 
  sleep, 
  replyPrivate, 
  relpyPrivate: replyPrivate, // 修复拼写错误但保持兼容
  downFile, 
  makeForwardMsg 
}
