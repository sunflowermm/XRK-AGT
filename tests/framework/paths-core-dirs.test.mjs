import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import paths from '../../src/utils/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const vibeLearnCore = path.join(repoRoot, 'core', 'vibe-learn-Core');

describe('paths.getCoreDirs', () => {
  before(() => {
    paths.invalidateCoreCache();
  });

  after(() => {
    paths.invalidateCoreCache();
  });

  it('warmup 后仍包含仅有 www 的 Core（不被 loader 子目录反推漏掉）', async () => {
    assert.ok(
      fs.existsSync(path.join(vibeLearnCore, 'www')),
      '本仓应存在 vibe-learn-Core/www（回归夹具）'
    );
    assert.equal(
      fs.existsSync(path.join(vibeLearnCore, 'plugin')),
      false,
      '夹具须无 plugin，才能覆盖「仅 www」场景'
    );

    await paths.warmupCoreLayout();
    const dirs = await paths.getCoreDirs();
    const names = dirs.map((d) => path.basename(d));

    assert.ok(
      names.includes('vibe-learn-Core'),
      `getCoreDirs 应含 vibe-learn-Core，实际: ${names.filter((n) => n.includes('vibe') || n.includes('Example')).join(',') || names.slice(0, 5).join(',')}`
    );
  });
});
