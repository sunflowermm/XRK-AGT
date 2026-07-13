/**
 * MongoDB-Core 公开 API — 业务 Core 唯一应 import 的入口
 *
 * @example
 * import { registerCollection, Repository, bootstrap } from '../../../mongodb-Core/lib/index.js';
 */
export { getDb, getCollection, ping } from './client.js';
export {
  registerCollection,
  getCollectionEntry,
  listCollections,
  assertRegistered,
} from './collection-registry.js';
export { Repository } from './repository-base.js';
export { withTransaction, withSession } from './transaction.js';
export { runMigrations, getMigrationStatus } from './migration-runner.js';
export { ensureIndexes } from './index-manager.js';
export { tenantCollectionName, tenantScope, withTenantMeta } from './tenant.js';
export { getMongoCoreConfig } from './config.js';
export { SystemMemoryRepo } from './store/system-memory-repo.js';

import { registerCollection } from './collection-registry.js';
import { getMongoCoreConfig } from './config.js';
import { ensureIndexes } from './index-manager.js';
import { runMigrations } from './migration-runner.js';
import { ping } from './client.js';

/** 注册 mongodb-Core 自身系统集合 */
function registerSystemCollections() {
  registerCollection('system', 'audit', {
    schemaVersion: 1,
    indexes: [{ key: { at: -1 }, name: 'audit_at_desc' }],
  });
  registerCollection('system', 'knowledge', {
    schemaVersion: 1,
    indexes: [{ key: { id: 1 }, unique: true, name: 'knowledge_id' }],
  });
  registerCollection('system', 'memory', {
    schemaVersion: 1,
    indexes: [
      { key: { workspaceId: 1, key: 1 }, unique: true, name: 'memory_ws_key' },
    ],
  });
}

let bootstrapped = false;

/**
 * 启动 bootstrap：注册系统集合、迁移、索引
 * @returns {Promise<{ ok: boolean, migrations?: string[], indexes?: object[] }>}
 */
export async function bootstrap() {
  if (bootstrapped) return { ok: true, skipped: true };
  bootstrapped = true;

  const alive = await ping();
  if (!alive) {
    throw new Error('[mongodb-Core] MongoDB 不可用，无法 bootstrap');
  }

  registerSystemCollections();

  const config = await getMongoCoreConfig();
  /** @type {string[]} */
  let migrations = [];
  /** @type {object[]} */
  let indexes = [];

  if (config.runMigrationsOnBoot !== false) {
    migrations = await runMigrations();
  }
  if (config.ensureIndexesOnBoot !== false) {
    indexes = await ensureIndexes();
  }

  return { ok: true, migrations, indexes };
}
