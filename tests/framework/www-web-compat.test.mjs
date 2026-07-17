import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  randomId,
  unwrapSuccess,
  abortTimeout,
  deepClone,
} from '../../core/system-Core/www/xrk/modules/web-compat.js';

const compatPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../core/system-Core/www/xrk/modules/web-compat.js'
);

describe('www/xrk web-compat', () => {
  it('存在 modules/web-compat.js', () => {
    assert.ok(fs.existsSync(compatPath));
  });

  it('randomId 返回非空字符串', () => {
    const id = randomId('t');
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 4);
  });

  it('unwrapSuccess：对象拍平', () => {
    const out = unwrapSuccess({ success: true, message: 'ok', assessments: [1], webVersion: '1' });
    assert.deepEqual(out, { assessments: [1], webVersion: '1' });
  });

  it('unwrapSuccess：优先 data 字段', () => {
    assert.deepEqual(unwrapSuccess({ success: true, message: 'ok', data: { a: 1 } }), { a: 1 });
    assert.deepEqual(unwrapSuccess({ success: true, message: 'ok', data: [1, 2] }), [1, 2]);
  });

  it('unwrapSuccess：失败抛错', () => {
    assert.throws(() => unwrapSuccess({ success: false, message: 'nope' }), /nope/);
  });

  it('abortTimeout 返回 AbortSignal', () => {
    const signal = abortTimeout(50);
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
  });

  it('deepClone 拷贝对象且不共享引用', () => {
    const src = { a: 1, nest: { b: 2 } };
    const copy = deepClone(src);
    assert.deepEqual(copy, src);
    assert.notEqual(copy, src);
    assert.notEqual(copy.nest, src.nest);
    copy.nest.b = 9;
    assert.equal(src.nest.b, 2);
  });
});
