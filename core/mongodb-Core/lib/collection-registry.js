/** @typedef {{ name: string, owner: string, entity: string, indexes?: object[], schemaVersion?: number, registeredAt: number }} CollectionEntry */

/** @type {Map<string, CollectionEntry>} */
const registry = new Map();

/**
 * 注册集合（业务 Core 必须通过此 API，禁止裸写集合名）
 * @param {string} owner Core 名，如 lsy、jm、system
 * @param {string} entity 实体名，如 users、orders
 * @param {{ indexes?: object[], schemaVersion?: number }} [options]
 */
export function registerCollection(owner, entity, options = {}) {
  const o = String(owner || '').trim();
  const e = String(entity || '').trim();
  if (!o || !e) {
    throw new Error('[mongodb-Core] registerCollection 需要 owner 与 entity');
  }
  if (!/^[a-z][a-z0-9_]*$/i.test(o) || !/^[a-z][a-z0-9_]*$/i.test(e)) {
    throw new Error('[mongodb-Core] owner/entity 仅允许字母数字下划线');
  }
  const name = `${o}_${e}`;
  const key = `${o}:${e}`;
  if (registry.has(key)) {
    return registry.get(key);
  }
  const entry = {
    name,
    owner: o,
    entity: e,
    indexes: options.indexes ?? [],
    schemaVersion: options.schemaVersion ?? 1,
    registeredAt: Date.now(),
  };
  registry.set(key, entry);
  return entry;
}

/** @param {string} owner @param {string} entity */
export function getCollectionEntry(owner, entity) {
  const entry = registry.get(`${owner}:${entity}`);
  if (!entry) {
    throw new Error(`[mongodb-Core] 集合未注册: ${owner}:${entity}，请先 registerCollection`);
  }
  return entry;
}

export function listCollections() {
  return [...registry.values()];
}

/** @param {string} owner @param {string} entity */
export function assertRegistered(owner, entity) {
  getCollectionEntry(owner, entity);
  return true;
}

export function clearRegistryForTests() {
  registry.clear();
}
