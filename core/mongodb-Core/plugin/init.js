import plugin from '#infrastructure/plugins/plugin.js';
import { setRuntimeGlobal } from '#utils/runtime-globals.js';
import * as MongoService from '../lib/index.js';

export default class MongoDbCoreInit extends plugin {
  constructor() {
    super({
      name: 'mongodb-core-init',
      dsc: 'MongoDB-Core 启动：迁移、索引、挂载 MongoService',
      event: 'message',
      priority: 1,
    });
  }

  async init() {
    if (MongoDbCoreInit._booted) return;
    MongoDbCoreInit._booted = true;
    try {
      const result = await MongoService.bootstrap();
      setRuntimeGlobal('MongoService', MongoService);
      const mig = result.migrations?.length ? result.migrations.join(',') : 'none';
      logger.mark(`[mongodb-Core] bootstrap OK migrations=[${mig}]`);
    } catch (err) {
      logger.error(`[mongodb-Core] bootstrap 失败: ${err.message}`);
      if (process.env.XRK_OPTIONAL_DB !== '1') throw err;
    }
  }
}

MongoDbCoreInit._booted = false;
