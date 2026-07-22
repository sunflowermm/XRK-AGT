/**
 * 消息定时撤回（模块级定时器，不绑短生命周期插件实例）
 *
 * 用法：
 * - setupReply 会把每次 reply 的 id 记入 e._sentMsgIds
 * - 多条需同时撤：createRecallBatch(e) → 发完 → batch.schedule({ delayMs })
 * - 或手动 extractMsgIds + scheduleMsgRecall
 * - 或 reply(msg, quote, { recallMsg: 秒 })
 */
import { normalizeError } from '#utils/normalize-error.js'

const _timers = new Set()

/** 相邻 delete_msg 间隔，降低协议端限流导致「只撤到一部分」 */
const RECALL_GAP_MS = 120

/**
 * @param {unknown} id
 * @returns {string|number|null}
 */
function normalizeMsgId(id) {
  if (id == null || id === '') return null
  if (typeof id === 'number' && Number.isFinite(id)) return id
  if (typeof id === 'bigint') return String(id)
  if (typeof id === 'string') {
    const s = id.trim()
    return s || null
  }
  // 部分实现把 id 包在对象里
  if (typeof id === 'object') {
    const nested = id.message_id ?? id.msg_id ?? id.messageId ?? id.id
    if (nested != null && nested !== id) return normalizeMsgId(nested)
  }
  return null
}

/**
 * 从任意发送结果中尽量抽出可撤回的 message_id
 * 兼容：直出 / data 包裹 / OneBot Proxy / 数组 / msg_id / messageId / 嵌套 ret
 * @param {any} msgRes
 * @returns {Array<string|number>}
 */
export function extractMsgIds(msgRes) {
  if (msgRes == null || msgRes === false) return []
  // 明确失败才跳过；勿把带 message_id 的成功体误判（部分适配 error:null）
  if (msgRes.error && !msgRes.message_id && !msgRes.msg_id && !msgRes.data) return []

  const out = []
  const seen = new Set()
  const push = (raw) => {
    const id = normalizeMsgId(raw)
    if (id == null) return
    const key = String(id)
    if (seen.has(key)) return
    seen.add(key)
    out.push(id)
  }

  const walk = (node, depth = 0) => {
    if (node == null || depth > 4) return
    if (typeof node !== 'object') {
      push(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }

    push(node.message_id)
    push(node.msg_id)
    push(node.messageId)
    // 少数实现用 id 表示发送结果 message_id（避免把业务 album id 误收：仅当同时无其它字段时不在这里盲收）
    if (node.message_id == null && node.msg_id == null && node.messageId == null) {
      // no-op for bare .id — 易与其它实体混淆
    }

    if (node.data != null) walk(node.data, depth + 1)
    if (node.result != null) walk(node.result, depth + 1)
    if (node.ret != null) walk(node.ret, depth + 1)
  }

  walk(msgRes)
  return out
}

/**
 * @param {object} e
 * @returns {Array<string|number>}
 */
export function ensureSentMsgIds(e) {
  if (!e) return []
  if (!Array.isArray(e._sentMsgIds)) e._sentMsgIds = []
  return e._sentMsgIds
}

/**
 * 把一次发送结果记入事件（setupReply / 插件均可调）
 * @returns {Array<string|number>} 本次新解析到的 id
 */
export function trackSentMsgIds(e, msgRes) {
  const ids = extractMsgIds(msgRes)
  if (!e || !ids.length) return ids
  const bucket = ensureSentMsgIds(e)
  const added = []
  for (const id of ids) {
    const key = String(id)
    if (bucket.some((x) => String(x) === key)) continue
    bucket.push(id)
    added.push(id)
  }
  return added.length ? added : ids
}

/**
 * 多条 reply 共用一批撤回：创建时记下起点，之后凡经 setupReply/track 的 id 都计入本批
 * @param {object} e
 */
export function createRecallBatch(e) {
  const bucket = ensureSentMsgIds(e)
  const start = bucket.length
  return {
    get ids() {
      return bucket.slice(start)
    },
    track(msgRes) {
      return trackSentMsgIds(e, msgRes)
    },
    /**
     * @param {object} [opts]
     * @param {number} [opts.delayMs]
     * @param {Array<string|number>} [opts.alsoRecall]
     * @param {string} [opts.logTag]
     */
    schedule(opts = {}) {
      return scheduleMsgRecall(e, bucket.slice(start), opts)
    },
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 顺序撤回，避免并行 delete_msg 被协议端丢弃
 * @param {{ recallMsg: Function }} target
 * @param {Array<string|number>} ids
 * @param {string} logTag
 */
async function recallAllSequential(target, ids, logTag) {
  let ok = 0
  let fail = 0
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    try {
      await Promise.resolve(target.recallMsg(id))
      ok += 1
    } catch (err) {
      fail += 1
      logger.warn(`[${logTag}] 撤回失败 msgId=${id}: ${normalizeError(err).message}`)
    }
    if (i < ids.length - 1 && RECALL_GAP_MS > 0) await sleep(RECALL_GAP_MS)
  }
  logger.info(`[${logTag}] 定时撤回完成 ok=${ok} fail=${fail} total=${ids.length}`)
}

/**
 * @param {object} e 事件（需 group/friend.recallMsg）
 * @param {Array<string|number>} msgIds bot 侧消息 id（可与 e._sentMsgIds 合并）
 * @param {object} [opts]
 * @param {number} [opts.delayMs=120000]
 * @param {Array<string|number>} [opts.alsoRecall] 额外 id（如用户原消息）
 * @param {boolean} [opts.includeTracked=false] 合并 e._sentMsgIds（整事件所有 reply）
 * @param {string} [opts.logTag='MsgRecall']
 * @returns {boolean} 是否已安排
 */
export function scheduleMsgRecall(e, msgIds, opts = {}) {
  const delayMs = Number(opts.delayMs) > 0 ? Number(opts.delayMs) : 120_000
  const logTag = opts.logTag || 'MsgRecall'
  const extra = Array.isArray(opts.alsoRecall) ? opts.alsoRecall : []
  const tracked = opts.includeTracked && e ? ensureSentMsgIds(e) : []
  const merged = [...(msgIds || []), ...tracked, ...extra]
  const seen = new Set()
  const ids = []
  for (const raw of merged) {
    const id = normalizeMsgId(raw)
    if (id == null) continue
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(id)
  }

  if (!ids.length || !e) {
    if (e) logger.warn(`[${logTag}] 无法定时撤回：没有可撤回的 message_id`)
    return false
  }

  const target = e.isGroup ? e.group : e.friend
  if (!target?.recallMsg) {
    logger.warn(`[${logTag}] 无法定时撤回：缺少 group/friend.recallMsg`)
    return false
  }

  const timer = setTimeout(() => {
    _timers.delete(timer)
    void recallAllSequential(target, ids, logTag)
  }, delayMs)

  _timers.add(timer)
  logger.info(`[${logTag}] 已安排 ${ids.length} 条 ${Math.round(delayMs / 1000)}s 后顺序撤回`)
  return true
}

/** 测试或热重载时可清掉挂起的撤回定时器 */
export function clearPendingMsgRecalls() {
  for (const timer of _timers) clearTimeout(timer)
  _timers.clear()
}
