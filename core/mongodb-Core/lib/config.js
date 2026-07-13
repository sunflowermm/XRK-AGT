import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

let configInstance;

export default class MongoDbCoreConfig extends ConfigBase {
  constructor() {
    super({
      name: 'mongodb-core',
      displayName: 'MongoDB-Core',
      description: 'MongoDB-Core 业务层：迁移、索引、审计与命名空间策略',
      filePath: 'data/mongodb-core/config.yaml',
      defaultTemplatePath: 'core/mongodb-Core/default/mongodb-core.yaml',
      fileType: 'yaml',
      schema: MongoDbCoreConfig.schemaDefinition(),
    });
  }

  static schemaDefinition() {
    return {
      fields: {
        runMigrationsOnBoot: {
          type: 'boolean',
          label: '启动时执行迁移',
          description: 'Bot 启动时自动运行 core/mongodb-Core/migrations 下未应用的脚本',
          default: true,
          component: 'Switch',
        },
        ensureIndexesOnBoot: {
          type: 'boolean',
          label: '启动时确保索引',
          description: '根据 registerCollection 声明自动 createIndexes',
          default: true,
          component: 'Switch',
        },
        auditWrites: {
          type: 'boolean',
          label: '写操作审计',
          description: '记录集合写入到 system_audit（实验性）',
          default: false,
          component: 'Switch',
        },
        collectionPrefix: {
          type: 'string',
          label: '全局集合前缀',
          description: '留空则仅使用 <core>_<entity>；非空时为 <prefix>_<core>_<entity>',
          default: '',
          component: 'Input',
        },
      },
    };
  }
}

/** @returns {Promise<Record<string, unknown>>} */
export async function getMongoCoreConfig() {
  if (!configInstance) configInstance = new MongoDbCoreConfig();
  return configInstance.read();
}

export function getMongoDbCoreConfigClass() {
  return MongoDbCoreConfig;
}
