import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEmotionKey, EMOTION_KEYS } from '../../core/system-Core/www/xrk/modules/ui-kit.js';

const wwwRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../core/system-Core/www/xrk'
);

const requiredFiles = [
  'index.html',
  'app.js',
  'styles.css',
  'modules/ui-kit.js',
  'modules/dom.js',
  'modules/system-overview.js',
  'modules/pages/home.js',
  'modules/pages/home-plugins-workflow.js',
  'css/styles-base.css',
  'css/pages.css'
];

describe('www/xrk 静态资源', () => {
  for (const rel of requiredFiles) {
    it(`存在 ${rel}`, () => {
      assert.ok(fs.existsSync(path.join(wwwRoot, rel)), rel);
    });
  }

  it('index.html 含主内容区与 toast 容器', () => {
    const html = fs.readFileSync(path.join(wwwRoot, 'index.html'), 'utf8');
    assert.match(html, /id="content"/);
    assert.match(html, /id="toastContainer"/);
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
