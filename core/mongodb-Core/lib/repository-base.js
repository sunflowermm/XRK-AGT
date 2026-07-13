import { getCollection } from './client.js';
import { getCollectionEntry } from './collection-registry.js';

/**
 * MongoDB Repository 基类 — 业务 Core 继承或组合使用
 * @example
 * const USERS = registerCollection('lsy', 'users');
 * class UserRepo extends Repository {
 *   constructor() { super(USERS); }
 * }
 */
export class Repository {
  /** @param {import('./collection-registry.js').CollectionEntry | { name: string }} collectionRef */
  constructor(collectionRef) {
    const name = collectionRef?.name ?? collectionRef;
    if (!name) throw new Error('[mongodb-Core] Repository 需要集合引用');
    this.collectionName = name;
  }

  col() {
    return getCollection(this.collectionName);
  }

  findOne(filter, options) {
    return this.col().findOne(filter, options);
  }

  find(filter, options) {
    return this.col().find(filter, options);
  }

  insertOne(doc, options) {
    return this.col().insertOne(doc, options);
  }

  insertMany(docs, options) {
    return this.col().insertMany(docs, options);
  }

  updateOne(filter, update, options) {
    return this.col().updateOne(filter, update, options);
  }

  updateMany(filter, update, options) {
    return this.col().updateMany(filter, update, options);
  }

  deleteOne(filter, options) {
    return this.col().deleteOne(filter, options);
  }

  deleteMany(filter, options) {
    return this.col().deleteMany(filter, options);
  }

  count(filter, options) {
    return this.col().countDocuments(filter, options);
  }

  aggregate(pipeline, options) {
    return this.col().aggregate(pipeline, options);
  }

  /** 按 owner:entity 解析已注册集合 */
  static fromRegistered(owner, entity) {
    const entry = getCollectionEntry(owner, entity);
    return new Repository(entry);
  }
}
