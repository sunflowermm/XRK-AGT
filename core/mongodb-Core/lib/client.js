import { getMongoDb } from '#infrastructure/database/index.js';

/** @returns {import('mongodb').Db} */
export function getDb() {
  const db = getMongoDb();
  if (!db) {
    throw new Error('[mongodb-Core] MongoDB 未连接，请检查 mongodb.yaml 与 MongoDB 服务');
  }
  return db;
}

/** @param {string} name */
export function getCollection(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('[mongodb-Core] 集合名无效');
  }
  return getDb().collection(name);
}

export async function ping() {
  const db = getMongoDb();
  if (!db) return false;
  try {
    await db.admin().ping();
    return true;
  } catch {
    return false;
  }
}
