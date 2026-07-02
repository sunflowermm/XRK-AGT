import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { callSubserver } from '#utils/subserver-client.js';

/**
 * 子服插件配置代理：读写走子服 HTTP CommonConfig API，不在主服重复 schema/字段。
 */
export default class SubserverConfigProxy extends ConfigBase {
  constructor(meta) {
    super({
      name: meta.name,
      displayName: meta.displayName ?? meta.name,
      description: meta.description ?? '',
      filePath: meta.filePath ?? '',
      fileType: 'yaml',
      schema: meta.schema ?? { fields: {} }
    });
    this.runtime = meta.runtime || 'pyserver';
    this.group = meta.group;
    this.source = 'subserver';
  }

  getInfo() {
    return {
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      filePath: this.filePath,
      fileType: this.fileType,
      source: this.source,
      runtime: this.runtime,
      group: this.group
    };
  }

  async read(useCache = true) {
    if (useCache && this._cache && Date.now() - this._cacheTime < this._cacheTTL) {
      return this._cache;
    }
    const res = await callSubserver(`/api/${this.group}/config/read`, {
      method: 'GET',
      runtime: this.runtime,
      timeout: 15000
    });
    const data = res?.data ?? res;
    this._applySchemaDefaults(data);
    this._cache = data;
    this._cacheTime = Date.now();
    return data;
  }

  async write(data, options = {}) {
    await callSubserver(`/api/${this.group}/config/write`, {
      method: 'POST',
      runtime: this.runtime,
      body: {
        data,
        backup: options.backup !== false,
        validate: options.validate !== false
      },
      timeout: 30000
    });
    this.clearCache();
    return true;
  }
}
