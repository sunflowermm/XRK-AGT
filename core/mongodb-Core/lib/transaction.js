import { getDb } from './client.js';

/**
 * 在 MongoDB 事务中执行 fn（需副本集或 sharded cluster）
 * @template T
 * @param {(session: import('mongodb').ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const db = getDb();
  const client = db.client;
  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * 手动 session 辅助（不自动提交）
 * @template T
 * @param {(session: import('mongodb').ClientSession) => Promise<T>} fn
 */
export async function withSession(fn) {
  const db = getDb();
  const session = db.client.startSession();
  try {
    return await fn(session);
  } finally {
    await session.endSession();
  }
}
