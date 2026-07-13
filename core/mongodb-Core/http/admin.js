import { HttpResponse } from '#utils/http-utils.js';

export default {
  name: 'mongodb-core-admin',
  dsc: 'MongoDB-Core 健康检查与管理 API',
  priority: 90,

  routes: [
    {
      method: 'GET',
      path: '/api/mongodb-core/health',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (_req, res) => {
        let ok = false;
        let migration = { applied: [], pending: [] };
        try {
          const svc = globalThis.MongoService;
          if (svc?.ping) ok = await svc.ping();
          if (ok && svc?.getMigrationStatus) {
            migration = await svc.getMigrationStatus();
          }
        } catch {
          ok = false;
        }
        HttpResponse.success(res, {
          status: ok ? 'operational' : 'down',
          mongodb: ok ? 'connected' : 'disconnected',
          migrations: migration,
          timestamp: Date.now(),
        });
      }, 'mongodb-core.health'),
    },
    {
      method: 'GET',
      path: '/api/mongodb-core/collections',
      handler: HttpResponse.asyncHandler(async (_req, res) => {
        const svc = globalThis.MongoService;
        if (!svc?.listCollections) {
          return HttpResponse.error(res, new Error('MongoService 未初始化'), 503, 'mongodb-core.collections');
        }
        const registered = svc.listCollections();
        HttpResponse.success(res, { collections: registered });
      }, 'mongodb-core.collections'),
    },
    {
      method: 'GET',
      path: '/api/mongodb-core/admin/stats',
      handler: HttpResponse.asyncHandler(async (_req, res) => {
        const svc = globalThis.MongoService;
        if (!svc?.getDb) {
          return HttpResponse.error(res, new Error('MongoService 未初始化'), 503, 'mongodb-core.stats');
        }
        const db = svc.getDb();
        const registered = svc.listCollections?.() ?? [];
        const stats = [];
        for (const entry of registered) {
          try {
            const col = db.collection(entry.name);
            const count = await col.estimatedDocumentCount();
            const idx = await col.indexes();
            stats.push({ name: entry.name, owner: entry.owner, entity: entry.entity, count, indexes: idx.length });
          } catch (err) {
            stats.push({ name: entry.name, error: err.message });
          }
        }
        HttpResponse.success(res, { stats });
      }, 'mongodb-core.stats'),
    },
  ],
};
