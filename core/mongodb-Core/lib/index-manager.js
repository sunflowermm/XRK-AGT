import { getCollection } from './client.js';
import { listCollections } from './collection-registry.js';

const META = '_mongodb_core_migrations';

/**
 * 为所有已注册集合创建声明的索引
 */
export async function ensureIndexes() {
  const results = [];
  for (const entry of listCollections()) {
    if (!entry.indexes?.length) continue;
    const col = getCollection(entry.name);
    const created = await col.createIndexes(entry.indexes);
    results.push({ collection: entry.name, indexes: created });
  }
  return results;
}

/** @param {string} collectionName */
export async function ensureCollectionIndexes(collectionName, indexes) {
  if (!indexes?.length) return [];
  return getCollection(collectionName).createIndexes(indexes);
}

export { META as MIGRATION_COLLECTION };
