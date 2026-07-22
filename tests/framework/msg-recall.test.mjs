/**
 * msg-recall：extract / remember / schedule
 */
import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractMsgIds,
  rememberSentMsgIds,
  scheduleMsgRecall,
  clearPendingMsgRecalls,
} from '../../src/utils/msg-recall.js'

before(() => {
  globalThis.logger ??= { info() {}, warn() {}, debug() {}, error() {} }
})

describe('extractMsgIds', () => {
  it('直出 / data / Proxy / 数组', () => {
    assert.deepEqual(extractMsgIds({ message_id: 11 }), [11])
    assert.deepEqual(extractMsgIds({ data: { message_id: 22 } }), [22])
    assert.deepEqual(extractMsgIds({ msg_id: '33', messageId: 44 }), ['33', 44])

    const proxied = new Proxy(
      { retcode: 0, data: { message_id: 55 } },
      { get: (t, p) => t.data[p] ?? t[p] }
    )
    assert.deepEqual(extractMsgIds(proxied), [55])
    assert.deepEqual(extractMsgIds({ message_id: [1, 2, 2] }), [1, 2])
    assert.deepEqual(extractMsgIds({ error: new Error('x') }), [])
  })
})

describe('rememberSentMsgIds + scheduleMsgRecall', () => {
  it('记账切片与顺序撤回', async () => {
    clearPendingMsgRecalls()
    const e = { isGroup: true, group: { recallMsg: mock.fn(async () => {}) } }
    rememberSentMsgIds(e, { message_id: 1 })
    const from = e._sentMsgIds.length
    rememberSentMsgIds(e, { message_id: 2 })
    rememberSentMsgIds(e, { data: { message_id: 3 } })

    assert.deepEqual(e._sentMsgIds.slice(from), [2, 3])
    assert.equal(
      scheduleMsgRecall(e, e._sentMsgIds.slice(from), { delayMs: 20, logTag: 'TestRecall' }),
      true
    )
    await new Promise((r) => setTimeout(r, 400))
    assert.deepEqual(
      e.group.recallMsg.mock.calls.map((c) => c.arguments[0]),
      [2, 3]
    )
    clearPendingMsgRecalls()
  })
})
