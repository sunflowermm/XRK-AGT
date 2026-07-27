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
  copyText,
} from '../../core/system-Core/www/xrk/src/utils/http.js';

const compatPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../core/system-Core/www/xrk/src/utils/http.js'
);

describe('www/xrk web-compat（http.js）', () => {
  it('存在 src/utils/http.js', () => {
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

  it('unwrapSuccess：数组在 data', () => {
    assert.deepEqual(unwrapSuccess({ success: true, message: 'ok', data: [1, 2] }), [1, 2]);
  });

  it('unwrapSuccess：失败抛错', () => {
    assert.throws(() => unwrapSuccess({ success: false, message: 'nope' }), /nope/);
  });

  it('abortTimeout 返回 AbortSignal', () => {
    const s = abortTimeout(50);
    assert.ok(s instanceof AbortSignal);
  });

  it('deepClone 拷贝对象', () => {
    const src = { a: 1, b: { c: 2 } };
    const out = deepClone(src);
    assert.deepEqual(out, src);
    assert.notEqual(out, src);
    assert.notEqual(out.b, src.b);
  });

  it('copyText 空串返回 false', async () => {
    assert.equal(await copyText(''), false);
  });
});
