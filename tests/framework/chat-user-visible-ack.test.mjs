import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUserVisibleTurnState,
  formatReplyQueuedAck,
  isOverlappingUserVisible
} from '../../src/utils/chat-user-visible-ack.js';

describe('chat user-visible ack', () => {
  it('createUserVisibleTurnState has reply queue fields', () => {
    const turn = createUserVisibleTurnState();
    assert.equal(turn.queuedReplyContent, '');
    assert.equal(turn.queuedReplyMessageId, null);
  });

  it('reply queued ack describes framework send timing', () => {
    const ack = formatReplyQueuedAck('群 1', '你好', '99');
    assert.match(ack, /你已通过 reply 拟定群 1的回复/);
    assert.match(ack, /统一发到 QQ/);
  });

  it('overlap detects repeat reply text', () => {
    assert.equal(isOverlappingUserVisible('你好呀', '你好呀'), true);
  });
});
