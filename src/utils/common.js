import { pipeline } from 'stream'
import { promisify } from 'util'
import fetch from 'node-fetch'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 发送私聊消息，仅给好友发送
 * @param userId qq号
 * @param msg 消息
 * @param uin 指定bot发送，默认为Bot
 */
const replyPrivate = async (userId, msg, uin = Bot.uin) => {
  const targetId = Number(userId)
  if (!targetId || !Bot?.fl?.get) return

  const friend = Bot.fl.get(targetId)
  if (!friend) return

  logger.mark(`发送好友消息[${friend.nickname}](${targetId})`)
  try {
    return await Bot[uin].pickUser(targetId).sendMsg(msg)
  } catch (err) {
    logger.mark(err)
    return undefined
  }
}

/**
 * 休眠函数
 * @param ms 毫秒
 */
function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 下载保存文件
 * @param fileUrl 下载地址
 * @param savePath 保存路径
 * @param param
 */
async function downFile (fileUrl, savePath, param = {}) {
  try {
    mkdirs(path.dirname(savePath))
    logger.debug(`[下载文件] ${fileUrl}`)
    const response = await fetch(fileUrl, param)
    const streamPipeline = promisify(pipeline)
    await streamPipeline(response.body, fs.createWriteStream(savePath))
    return true
  } catch (err) {
    logger.error(`下载文件错误：${err}`)
    return false
  }
}

function mkdirs (dirname) {
  if (!dirname) return false
  fs.mkdirSync(dirname, { recursive: true })
  return true
}

/**
 * 制作转发消息
 * @param e 消息事件
 * @param msg 消息数组
 * @param dec 转发描述
 */
function makeForwardMsg(e, msg = [], dec = '', nm = [], msgsscr = false) {
  const messages = Array.isArray(msg) ? msg : [msg]
  const forwardMsg = dec ? [{ message: dec }, ...messages.map(message => ({ message }))] : messages.map(message => ({ message }))

  if (e?.group?.makeForwardMsg) return e.group.makeForwardMsg(forwardMsg)
  else if (e?.friend?.makeForwardMsg) return e.friend.makeForwardMsg(forwardMsg)
  else return Bot.makeForwardMsg(forwardMsg)
}

export default { sleep, replyPrivate, relpyPrivate: replyPrivate, downFile, makeForwardMsg }
