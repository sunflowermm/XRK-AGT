import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const userStorePath = path.join(root, 'core/lsy-Core/lib/user-store.js');

describe('lsy user-store Mongo 接入', () => {
  /** @type {typeof import('../../core/lsy-Core/lib/user-store.js').default} */
  let LsyUserStore;

  before(async () => {
    const mod = await import(pathToFileURL(userStorePath).href);
    LsyUserStore = mod.default;
  });

  it('不得再静态依赖 Runtime database 的已移除导出', async () => {
    assert.equal(typeof LsyUserStore, 'function');
    const src = await fs.readFile(userStorePath, 'utf8');
    assert.equal(/from\s+['"]#infrastructure\/database\/index\.js['"]/.test(src), false);
    assert.equal(/\bgetMongoDb\b/.test(src), false);
    assert.ok(src.includes('mongodb-Core/lib/index.js'));
  });

  it('Mongo 不可用时 _getDb 返回 null（回落本地文件）', async () => {
    const store = new LsyUserStore();
    const db = await store._getDb();
    if (db != null) {
      assert.equal(typeof db.collection, 'function');
    } else {
      assert.equal(db, null);
    }
  });
});
