import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapTestEnv } from '../helpers/bootstrap.mjs';
import { SYSTEM_CORE_VENDOR_PLUGINS } from '../../src/utils/loader-constants.js';
import {
  SYSTEM_CORE_BASELINE,
  systemCoreHttpApiKeys,
  systemCoreStreamBasenames,
} from '../helpers/system-core.mjs';

describe('加载器集成（system-Core 基准）', () => {
  before(bootstrapTestEnv);

  it(`ApiLoader 注册全部 ${SYSTEM_CORE_BASELINE.http} 个 system-Core HTTP 模块`, async () => {
    const { default: ApiLoader } = await import('../../src/infrastructure/http/loader.js');
    const apis = await ApiLoader.load();
    const keys = systemCoreHttpApiKeys();
    assert.equal(keys.length, SYSTEM_CORE_BASELINE.http);
    for (const key of keys) {
      assert.ok(apis.has(key), `缺少 API: ${key}`);
    }
  });

  it(`PluginsLoader 至少加载 system-Core 的 ${SYSTEM_CORE_BASELINE.plugin} 个插件`, async () => {
    const { default: PluginsLoader } = await import('../../src/infrastructure/plugins/loader.js');
    const listed = (await PluginsLoader.getPlugins())
      .filter((p) => p.core === 'system-Core')
      .filter((p) => !SYSTEM_CORE_VENDOR_PLUGINS.includes(p.name));
    assert.equal(listed.length, SYSTEM_CORE_BASELINE.plugin);
    await PluginsLoader.load(true);
    assert.ok(PluginsLoader.pluginCount >= SYSTEM_CORE_BASELINE.plugin);
  });

  it('StreamLoader 加载全部 7 个 system-Core 工作流', async () => {
    const basenames = systemCoreStreamBasenames();
    assert.equal(basenames.length, SYSTEM_CORE_BASELINE.stream);
    const { default: StreamLoader } = await import('../../src/infrastructure/aistream/loader.js');
    await StreamLoader.load(true);
    const loaded = new Set(StreamLoader.streams.keys());
    for (const name of basenames) {
      assert.ok(loaded.has(name), `缺少工作流: ${name}`);
    }
    assert.ok(
      StreamLoader.getStats().total >= SYSTEM_CORE_BASELINE.stream,
      `已加载工作流总数 ${StreamLoader.getStats().total}`,
    );
  });
});
