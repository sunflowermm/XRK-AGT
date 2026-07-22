/**
 * 消息定时撤回（模块级定时器，不绑插件实例）
 *
 * - setupReply：每次 reply 把 id 写入 e._sentMsgIds
 * - 单条：reply(msg, quote, { recallMsg: 秒 })
 * - 多条一并撤：
 *     const from = (e._sentMsgIds ||= []).length
 *     await reply...
 *     scheduleMsgRecall(e, e._sentMsgIds.slice(from), { delayMs })
 */
import { normalizeError } from '#utils/normalize-error.js'

const _timers = new Set()
const RECALL_GAP_MS = 120

/**
 * @param {any} msgRes
 * @returns {Array<string|number>}
 */
export function extractMsgIds(msgRes) {
  if (msgRes == null || msgRes === false) return []
  if (msgRes.error && msgRes.message_id == null && msgRes.msg_id == null && msgRes.data == null) {
    return []
  }

  const out = []
  const seen = new Set()
  const push = (raw) => {
    let id = raw
    if (id == null || id === '') return
    if (typeof id === 'object') {
      id = id.message_id ?? id.msg_id ?? id.messageId
      if (id == null || id === '' || typeof id === 'object') return
    }
    if (typeof id === 'bigint') id = String(id)
    const key = String(id)
    if (seen.has(key)) return
    seen.add(key)
    out.push(id)
  }
  const take = (v) => {
    if (Array.isArray(v)) for (const x of v) push(x)
    else push(v)
  }

  take(msgRes.message_id)
  take(msgRes.msg_id)
  take(msgRes.messageId)

  const data = msgRes.data
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      take(item.message_id)
      take(item.msg_id)
      take(item.messageId)
    }
  } else if (data && typeof data === 'object') {
    take(data.message_id)
    take(data.msg_id)
    take(data.messageId)
  }

  return out
}

/** @param {object} e @param {any} msgRes */
export function rememberSentMsgIds(e, msgRes) {
  if (!e) return extractMsgIds(msgRes)
  const ids = extractMsgIds(msgRes)
  if (!ids.length) return ids
  const bucket = e._sentMsgIds ||= []
  for (const id of ids) {
    if (!bucket.some((x) => String(x) === String(id))) bucket.push(id)
  }
  return ids
}

/**
 * @param {object} e
 * @param {Array<string|number>} msgIds
 * @param {object} [opts]
 * @param {number} [opts.delayMs=120000]
 * @param {Array<string|number>} [opts.alsoRecall]
 * @param {string} [opts.logTag='MsgRecall']
 */
export function scheduleMsgRecall(e, msgIds, opts = {}) {
  const delayMs = Number(opts.delayMs) > 0 ? Number(opts.delayMs) : 120_000
  const logTag = opts.logTag || 'MsgRecall'
  const extra = Array.isArray(opts.alsoRecall) ? opts.alsoRecall : []
  const seen = new Set()
  const ids = []
  for (const raw of [...(msgIds || []), ...extra]) {
    if (raw == null || raw === '') continue
    const key = String(raw)
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(raw)
  }

  if (!ids.length || !e) {
    if (e) logger.warn(`[${logTag}] 无法定时撤回：没有 message_id`)
    return false
  }

  const target = e.isGroup ? e.group : e.friend
  if (!target?.recallMsg) {
    logger.warn(`[${logTag}] 无法定时撤回：缺少 group/friend.recallMsg`)
    return false
  }

  const timer = setTimeout(() => {
    _timers.delete(timer)
    void (async () => {
      let ok = 0
      for (let i = 0; i < ids.length; i++) {
        try {
          await Promise.resolve(target.recallMsg(ids[i]))
          ok += 1
        } catch (err) {
          logger.warn(`[${logTag}] 撤回失败 msgId=${ids[i]}: ${normalizeError(err).message}`)
        }
        if (i < ids.length - 1) await new Promise((r) => setTimeout(r, RECALL_GAP_MS))
      }
      logger.info(`[${logTag}] 定时撤回完成 ok=${ok}/${ids.length}`)
    })()
  }, delayMs)

  _timers.add(timer)
  logger.info(`[${logTag}] 已安排 ${ids.length} 条 ${Math.round(delayMs / 1000)}s 后撤回`)
  return true
}

export function clearPendingMsgRecalls() {
  for (const timer of _timers) clearTimeout(timer)
  _timers.clear()
}
