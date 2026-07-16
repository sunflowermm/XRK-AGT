import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRequestId,
  enterRequestContext,
  getRequestContext,
  createSpan,
} from '../../src/utils/observability.js';

describe('observability', () => {
  it('resolveRequestId 优先入站 X-Request-Id', () => {
    const id = resolveRequestId({
      headers: { 'x-request-id': 'client-trace-1' },
    });
    assert.equal(id, 'client-trace-1');
  });

  it('enterRequestContext 可被 getRequestContext 读到', () => {
    enterRequestContext({ requestId: 'r-als', path: '/x', method: 'GET' });
    assert.equal(getRequestContext()?.requestId, 'r-als');
  });

  it('createSpan.end 返回耗时毫秒', () => {
    const span = createSpan('unit-test');
    const ms = span.end({ ok: true });
    assert.ok(Number.isFinite(ms) && ms >= 0);
  });
});
