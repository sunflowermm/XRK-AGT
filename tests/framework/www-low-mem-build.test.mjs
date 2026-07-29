import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMaxOldSpaceSize,
  isWwwLowMemHost,
  resolveWwwBuildChildEnv,
  WWW_LOW_MEM_BYTES,
} from '../../src/infrastructure/http/www-static-build.js';

describe('www 低配构建环境', () => {
  it('识别 ≤2.5G 为低配', () => {
    assert.equal(isWwwLowMemHost(2 * 1024 ** 3), true);
    assert.equal(isWwwLowMemHost(WWW_LOW_MEM_BYTES), true);
    assert.equal(isWwwLowMemHost(8 * 1024 ** 3), false);
  });

  it('ensureMaxOldSpaceSize 不覆盖已有 flag', () => {
    assert.equal(ensureMaxOldSpaceSize('', 768), '--max-old-space-size=768');
    assert.equal(
      ensureMaxOldSpaceSize('--max-old-space-size=4096', 768),
      '--max-old-space-size=4096',
    );
  });

  it('低配注入 XRK_WWW_BUILD_LOW_MEM 与堆上限', () => {
    const env = resolveWwwBuildChildEnv({}, { totalmem: 2 * 1024 ** 3 });
    assert.equal(env.XRK_WWW_BUILD_LOW_MEM, '1');
    assert.match(env.NODE_OPTIONS, /--max-old-space-size=768/);
    assert.equal(env.GOMAXPROCS, '1');
  });

  it('高配不注入', () => {
    const prev = process.env.XRK_WWW_BUILD_LOW_MEM;
    delete process.env.XRK_WWW_BUILD_LOW_MEM;
    try {
      const env = resolveWwwBuildChildEnv({ FOO: '1' }, { totalmem: 8 * 1024 ** 3 });
      assert.equal(env.XRK_WWW_BUILD_LOW_MEM, undefined);
      assert.equal(env.FOO, '1');
      assert.equal(env.NODE_OPTIONS, undefined);
    } finally {
      if (prev !== undefined) process.env.XRK_WWW_BUILD_LOW_MEM = prev;
    }
  });
});
