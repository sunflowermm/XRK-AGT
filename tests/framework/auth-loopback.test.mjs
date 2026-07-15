import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLoopback127Connection,
  shouldForceAuthOnLoopbackWhenToolsRun,
} from '../../src/infrastructure/http/auth.js';
import * as runtimeAuth from '../../src/infrastructure/http/runtime-auth.js';

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

describe('HTTP 鉴权：forceAuth / runtime-auth', () => {
  it('shouldForceAuthOnLoopbackWhenToolsRun 返回 boolean', () => {
    assert.equal(typeof shouldForceAuthOnLoopbackWhenToolsRun(), 'boolean');
  });

  it('forceAuth 时 loopback 缺 Key 拒绝', () => {
    const runtime = {
      apiKey: 'k'.repeat(32),
      _authWhitelistCache: { ref: undefined, rules: [] },
    };
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1',
      path: '/api/x',
      headers: {},
      query: {},
      body: {},
    };
    assert.equal(runtimeAuth.checkApiAuthorization(runtime, req, { forceAuth: true }), false);
  });

  it('forceAuth 时正确 Key 通过', () => {
    const key = 'a'.repeat(32);
    const runtime = {
      apiKey: key,
      _authWhitelistCache: { ref: undefined, rules: [] },
    };
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1',
      path: '/api/x',
      headers: { 'x-api-key': key },
      query: {},
      body: {},
    };
    assert.equal(runtimeAuth.checkApiAuthorization(runtime, req, { forceAuth: true }), true);
  });

  it('无 forceAuth 时 loopback 免 Key', () => {
    const runtime = {
      apiKey: 'k'.repeat(32),
      _authWhitelistCache: { ref: undefined, rules: [] },
    };
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1',
      path: '/api/x',
      headers: {},
      query: {},
      body: {},
    };
    // 仅当当前进程配置未因 runEnabled 强制时成立；forceAuth=false 且非 tools 强制 → true
    if (!shouldForceAuthOnLoopbackWhenToolsRun()) {
      assert.equal(runtimeAuth.checkApiAuthorization(runtime, req), true);
    }
  });
});
