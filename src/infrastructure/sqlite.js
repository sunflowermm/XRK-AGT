/**
 * Runtime 嵌入式 SQLite（Node 内置 `node:sqlite` · DatabaseSync）
 *
 * 与 Redis 同级：由 DatabaseManager 启动期 fail-fast 初始化，挂全局裸名 `sqlite`。
 * 勿使用 npm sqlite3/sqlite；本仓 Node ≥26。
 *
 * @see https://nodejs.org/api/sqlite.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import runtimeConfig from './config/config.js';
import paths from '#utils/paths.js';
import { setRuntimeGlobal } from '#utils/runtime-globals.js';

/** @type {import('node:sqlite').DatabaseSync | null} */
let globalDb = null;
/** @type {string|null} */
let globalDbPath = null;

/** @returns {import('node:sqlite').DatabaseSync|null} */
function resolveDb() {
  const fromGlobal = globalThis.sqlite;
  if (fromGlobal?.isOpen) {
    if (globalDb !== fromGlobal) globalDb = fromGlobal;
    return fromGlobal;
  }
  return globalDb?.isOpen ? globalDb : null;
}

/** @returns {import('node:sqlite').DatabaseSync} */
function requireDb() {
  const db = resolveDb();
  if (!db) throw new Error('[SQLite] 未初始化');
  return db;
}

/**
 * 解析 SQLite 文件路径
 * @param {Record<string, unknown>} [cfg] runtimeConfig.sqlite
 * @returns {string} 绝对路径或 `':memory:'`
 */
export function resolveSqliteFilePath(cfg = runtimeConfig.sqlite || {}) {
  if (process.env.XRK_SQLITE_MEMORY === '1' || cfg.memory === true) {
    return ':memory:';
  }
  const raw = String(cfg.filePath || 'data/runtime/xrk_agt.db').trim();
  if (!raw || raw === ':memory:') return ':memory:';
  return path.isAbsolute(raw) ? raw : path.join(paths.root, raw);
}

/**
 * 打开 Runtime SQLite（幂等）
 * @returns {import('node:sqlite').DatabaseSync}
 */
export default function sqliteInit() {
  if (globalDb?.isOpen) return globalDb;

  const cfg = runtimeConfig.sqlite || {};
  if (cfg.enabled === false) {
    throw new Error('sqlite.enabled=false');
  }

  const filePath = resolveSqliteFilePath(cfg);
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const busy = Number(cfg.busyTimeoutMs);
  /** @type {ConstructorParameters<typeof DatabaseSync>[1]} */
  const openOpts = {
    open: true,
    enableForeignKeyConstraints: cfg.foreignKeys !== false,
  };
  if (Number.isFinite(busy) && busy >= 0) {
    openOpts.timeout = Math.floor(busy);
  }

  const db = new DatabaseSync(filePath, openOpts);
  applyPragmas(db, cfg, filePath);
  db.prepare('SELECT 1 AS ok').get();
  ensureRuntimeSchema(db);

  globalDb = db;
  globalDbPath = filePath;
  setRuntimeGlobal('sqlite', db);
  return db;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, unknown>} cfg
 * @param {string} filePath
 */
function applyPragmas(db, cfg, filePath) {
  if (cfg.walMode !== false && filePath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      /* 部分文件系统不支持 WAL */
    }
  }
  if (cfg.foreignKeys !== false) {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/**
 * 创建 Runtime 元表（幂等）
 * @param {import('node:sqlite').DatabaseSync} db
 */
function ensureRuntimeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _xrk_runtime_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS _xrk_runtime_kv (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (namespace, key)
    );
  `);
  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO _xrk_runtime_meta (key, value, updated_at) VALUES (@key, @value, @updated_at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  upsert.run({ key: 'schema_version', value: '1', updated_at: now });
  upsert.run({ key: 'engine', value: 'node:sqlite', updated_at: now });
}

/**
 * Runtime KV 写入（本地持久标记，非 Redis 替代）
 * @param {string} namespace
 * @param {string} key
 * @param {string|null|undefined} value
 */
export function sqliteKvSet(namespace, key, value) {
  const db = requireDb();
  const ns = String(namespace || '').trim();
  const k = String(key || '').trim();
  if (!ns || !k) throw new TypeError('sqliteKvSet 需要 namespace 与 key');
  db.prepare(
    `INSERT INTO _xrk_runtime_kv (namespace, key, value, updated_at)
     VALUES (@namespace, @key, @value, @updated_at)
     ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run({
    namespace: ns,
    key: k,
    value: value == null ? null : String(value),
    updated_at: Date.now(),
  });
}

/**
 * @param {string} namespace
 * @param {string} key
 * @returns {string|null}
 */
export function sqliteKvGet(namespace, key) {
  const row = requireDb()
    .prepare(`SELECT value FROM _xrk_runtime_kv WHERE namespace = ? AND key = ? LIMIT 1`)
    .get(String(namespace), String(key));
  return row?.value ?? null;
}

/**
 * @param {string} namespace
 * @param {string} key
 */
export function sqliteKvDel(namespace, key) {
  requireDb()
    .prepare(`DELETE FROM _xrk_runtime_kv WHERE namespace = ? AND key = ?`)
    .run(String(namespace), String(key));
}

/** @returns {import('node:sqlite').DatabaseSync|null} */
export function getSqliteClient() {
  return resolveDb();
}

/** @returns {string|null} */
export function getSqlitePath() {
  return globalDbPath;
}

/** @returns {boolean} */
export function checkSqlite() {
  const db = resolveDb();
  if (!db) return false;
  try {
    return db.prepare('SELECT 1 AS ok').get()?.ok === 1;
  } catch {
    return false;
  }
}

/**
 * 同步事务（BEGIN IMMEDIATE）
 * @template T
 * @param {(db: import('node:sqlite').DatabaseSync) => T} fn
 * @returns {T}
 */
export function withSqliteTransaction(fn) {
  const db = requireDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * @param {string} sql
 * @returns {import('node:sqlite').StatementSync}
 */
export function sqlitePrepare(sql) {
  return requireDb().prepare(sql);
}

/** 关闭连接并清空全局挂载 */
export function closeSqlite() {
  const db = resolveDb();
  if (!db) {
    globalDb = null;
    globalDbPath = null;
    setRuntimeGlobal('sqlite', null);
    return;
  }
  try {
    if (db.isOpen) db.close();
  } catch {
    /* ignore */
  }
  globalDb = null;
  globalDbPath = null;
  setRuntimeGlobal('sqlite', null);
}
