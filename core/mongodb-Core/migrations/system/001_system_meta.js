/** @type {{ id: string, up: (db: import('mongodb').Db) => Promise<void> }} */
export default {
  id: '001_system_meta',
  async up(db) {
    await db.collection('_mongodb_core_migrations').createIndex({ id: 1 }, { unique: true });
  },
};
