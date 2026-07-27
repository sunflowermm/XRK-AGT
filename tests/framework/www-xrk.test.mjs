import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEmotionKey, EMOTION_KEYS } from '../../core/system-Core/www/xrk/src/utils/http.js';

const wwwRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../core/system-Core/www/xrk'
);

const requiredFiles = [
  'package.json',
  'vite.config.js',
  'sign.json',
  'index.html',
  'src/main.js',
  'src/App.vue',
  'src/layouts/AppShell.vue',
  'src/views/HomeView.vue',
  'src/views/ChatView.vue',
  'src/views/ConfigView.vue',
  'src/views/ApiDebugView.vue',
  'src/utils/http.js',
  'public/api-config.json',
];

describe('www/xrk Vue 控制台', () => {
  for (const rel of requiredFiles) {
    it(`存在 ${rel}`, () => {
      assert.ok(fs.existsSync(path.join(wwwRoot, rel)), rel);
    });
  }

  it('sign.json 静态挂 dist', () => {
    const sign = JSON.parse(fs.readFileSync(path.join(wwwRoot, 'sign.json'), 'utf8'));
    assert.equal(sign.enabled, false);
    assert.equal(sign.serve, 'static');
    assert.equal(sign.staticRoot, 'dist');
    assert.equal(sign.proxy?.mount, '/xrk');
  });

  it('vite base 为 /xrk/', () => {
    const vite = fs.readFileSync(path.join(wwwRoot, 'vite.config.js'), 'utf8');
    assert.match(vite, /base:\s*`\$\{mount\}\/`/);
    assert.match(vite, /const mount = '\/xrk'/);
  });

  it('http 工具含 unwrapSuccess', () => {
    const src = fs.readFileSync(path.join(wwwRoot, 'src/utils/http.js'), 'utf8');
    assert.match(src, /export function unwrapSuccess/);
    assert.match(src, /export function abortTimeout/);
  });
});

describe('ui-kit 情绪 key', () => {
  it('非法 key 回退为 happy', () => {
    assert.equal(normalizeEmotionKey('invalid'), 'happy');
    assert.equal(normalizeEmotionKey('happy'), 'happy');
  });

  it('EMOTION_KEYS 包含标准集合', () => {
    for (const k of ['happy', 'message', 'think']) {
      assert.ok(EMOTION_KEYS.has(k));
    }
  });
});
