import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPackageInstalled,
  getPlaywrightChromiumStatus
} from '../../src/utils/bootstrap-deps.js';
import { createSimpleLogger } from '../../src/utils/simple-logger.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Bootstrap 依赖检测', () => {
  it('已安装依赖可被识别', () => {
    assert.ok(isPackageInstalled('pino', path.join(root, 'node_modules'), root));
    assert.ok(isPackageInstalled('playwright', path.join(root, 'node_modules'), root));
  });

  it('缺失依赖返回 false', () => {
    assert.equal(isPackageInstalled('__not_a_real_pkg__', path.join(root, 'node_modules'), root), false);
  });

  it('getPlaywrightChromiumStatus 返回结构', async () => {
    const status = await getPlaywrightChromiumStatus(root);
    assert.equal(typeof status.playwrightInstalled, 'boolean');
    assert.equal(typeof status.browserInstalled, 'boolean');
  });
});

describe('simple-logger', () => {
  it('createSimpleLogger 返回标准方法', () => {
    const logger = createSimpleLogger(path.join(root, 'trash', 'test-simple-logger.log'), true);
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.error, 'function');
  });
});
