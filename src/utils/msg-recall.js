/**
 * 消息定时撤回（模块级定时器，不绑短生命周期插件实例）
 *
 * 用法：
 * - 收集多次 reply 的 message_id，最后一次性 scheduleMsgRecall(e, ids, { delayMs })
 * - 或 reply(msg, quote, { recallMsg: 秒 }) 由 setupReply 调用本模块
 */
import { normalizeError } from '#utils/normalize-error.js'

const _timers = new Set()

/**
 * 从发送结果中尽量抽出可撤回的 message_id（兼容数组 / data 包裹 / msg_id）
 * @param {any} msgRes
 * @returns {Array<string|number>}
 */
export function extractMsgIds(msgRes) {
  if (msgRes == null || msgRes === false || msgRes.error) return []

  const out = []
  const push = (id) => {
    if (id == null || id === '') return
    out.push(id)
  }

  if (Array.isArray(msgRes.message_id)) {
    for (const id of msgRes.message_id) push(id)
  } else if (msgRes.message_id != null) {
    push(msgRes.message_id)
  }

  if (msgRes.msg_id != null) push(msgRes.msg_id)

  const data = msgRes.data
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      if (Array.isArray(item.message_id)) {
        for (const id of item.message_id) push(id)
      } else {
        push(item.message_id)
        push(item.msg_id)
      }
    }
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.message_id)) {
      for (const id of data.message_id) push(id)
    } else {
      push(data.message_id)
      push(data.msg_id)
    }
  }

  return [...new Set(out)]
}

/**
 * @param {object} e 事件（需 group/friend.recallMsg）
 * @param {Array<string|number>} msgIds bot 侧消息 id
 * @param {object} [opts]
 * @param {number} [opts.delayMs=120000]
 * @param {Array<string|number>} [opts.alsoRecall] 额外 id（如用户原消息）
 * @param {string} [opts.logTag='MsgRecall']
 * @returns {boolean} 是否已安排
 */
export function scheduleMsgRecall(e, msgIds, opts = {}) {
  const delayMs = Number(opts.delayMs) > 0 ? Number(opts.delayMs) : 120_000
  const logTag = opts.logTag || 'MsgRecall'
  const extra = Array.isArray(opts.alsoRecall) ? opts.alsoRecall : []
  const ids = [...new Set([...(msgIds || []), ...extra].filter((id) => id != null && id !== ''))]

  if (!ids.length || !e) return false

  const target = e.isGroup ? e.group : e.friend
  if (!target?.recallMsg) {
    logger.warn(`[${logTag}] 无法定时撤回：缺少 group/friend.recallMsg`)
    return false
  }

  const timer = setTimeout(() => {
    _timers.delete(timer)
    let ok = 0
    for (const id of ids) {
      Promise.resolve(target.recallMsg(id))
        .then(() => {
          ok += 1
        })
        .catch((err) => {
          logger.debug(`[${logTag}] 撤回失败 msgId=${id}: ${normalizeError(err).message}`)
        })
    }
    // 不 await：仅打安排完成日志；单条失败走 debug
    logger.info(`[${logTag}] 定时撤回触发 count=${ids.length}`)
    void ok
  }, delayMs)

  _timers.add(timer)
  logger.debug(`[${logTag}] 已安排 ${ids.length} 条 ${Math.round(delayMs / 1000)}s 后同时撤回`)
  return true
}

/** 测试或热重载时可清掉挂起的撤回定时器 */
export function clearPendingMsgRecalls() {
  for (const timer of _timers) clearTimeout(timer)
  _timers.clear()
}
