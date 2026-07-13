import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb } from './client.js';
import { MIGRATION_COLLECTION } from './index-manager.js';
import paths from '#utils/paths.js';

/**
 * @typedef {{ id: string, up: (db: import('mongodb').Db) => Promise<void> }} Migration
 */

/** @returns {Promise<string[]>} */
async function listMigrationFiles() {
  const root = path.join(paths.root, 'core', 'mongodb-Core', 'migrations');
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.name.endsWith('.js') && !ent.name.startsWith('_')) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

/** @param {string} file */
async function loadMigration(file) {
  const mod = await import(pathToFileURL(file).href);
  const migration = mod.default ?? mod;
  if (!migration?.id || typeof migration.up !== 'function') {
    throw new Error(`[mongodb-Core] 无效迁移文件: ${file}`);
  }
  return /** @type {Migration} */ (migration);
}

export async function getMigrationStatus() {
  const db = getDb();
  const col = db.collection(MIGRATION_COLLECTION);
  const applied = await col.find({}).sort({ id: 1 }).toArray();
  const files = await listMigrationFiles();
  const pending = [];
  const appliedIds = new Set(applied.map((d) => d.id));
  for (const file of files) {
    const m = await loadMigration(file);
    if (!appliedIds.has(m.id)) pending.push(m.id);
  }
  return { applied: applied.map((d) => d.id), pending, total: files.length };
}

export async function runMigrations() {
  const db = getDb();
  const col = db.collection(MIGRATION_COLLECTION);
  await col.createIndex({ id: 1 }, { unique: true });

  const files = await listMigrationFiles();
  const applied = [];
  for (const file of files) {
    const migration = await loadMigration(file);
    const exists = await col.findOne({ id: migration.id });
    if (exists) continue;
    await migration.up(db);
    await col.insertOne({ id: migration.id, appliedAt: new Date(), file: path.relative(paths.root, file) });
    applied.push(migration.id);
  }
  return applied;
}
