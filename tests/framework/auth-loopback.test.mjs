import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopback127Connection } from '../../src/infrastructure/http/auth.js';

describe('HTTP 鉴权：127 回环判定', () => {
  it('127.0.0.1 为回环', () => {
    assert.equal(isLoopback127Connection('127.0.0.1'), true);
    assert.equal(isLoopback127Connection('::ffff:127.0.0.1'), true);
  });

  it('非 127 不放行', () => {
    assert.equal(isLoopback127Connection('192.168.1.1'), false);
    assert.equal(isLoopback127Connection('::1'), false);
    assert.equal(isLoopback127Connection(''), false);
  });
});
