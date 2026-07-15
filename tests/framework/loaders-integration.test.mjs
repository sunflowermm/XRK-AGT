import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapTestEnv } from '../helpers/bootstrap.mjs';
import {
  SYSTEM_CORE_BASELINE,
  systemCoreHttpApiKeys,
  systemCoreStreamBasenames,
} from '../helpers/system-core.mjs';

describe('加载器集成（system-Core 基准）', () => {
  before(bootstrapTestEnv);

  it(`HttpApiLoader 注册全部 ${SYSTEM_CORE_BASELINE.http} 个 system-Core HTTP 模块`, async () => {
    const { default: HttpApiLoader } = await import('../../src/infrastructure/http/loader.js');
    const apis = await HttpApiLoader.load();
    const keys = systemCoreHttpApiKeys();
    assert.equal(keys.length, SYSTEM_CORE_BASELINE.http);
    for (const key of keys) {
      assert.ok(apis.has(key), `缺少 API: ${key}`);
    }
  });

  it(`PluginLoader 至少加载 system-Core 入库的 ${SYSTEM_CORE_BASELINE.plugin} 个插件`, async () => {
    const { default: PluginLoader } = await import('../../src/infrastructure/plugins/loader.js');
    const { systemCorePluginKeys } = await import('../helpers/system-core.mjs');
    const officialKeys = systemCorePluginKeys();
    const listed = (await PluginLoader.getPlugins()).filter((p) => p.core === 'system-Core');
    for (const key of officialKeys) {
      assert.ok(listed.some((p) => p.name === key), `缺少入库插件: ${key}`);
    }
    await PluginLoader.load(true);
    assert.ok(PluginLoader.pluginCount >= SYSTEM_CORE_BASELINE.plugin);
  });

  it(`AiStreamLoader 加载全部 ${SYSTEM_CORE_BASELINE.stream} 个 system-Core 工作流`, async () => {
    const basenames = systemCoreStreamBasenames();
    assert.equal(basenames.length, SYSTEM_CORE_BASELINE.stream);
    const { default: AiStreamLoader } = await import('../../src/infrastructure/ai-workflow/loader.js');
    await AiStreamLoader.load(true);
    const loaded = new Set(AiStreamLoader.streams.keys());
    for (const name of basenames) {
      assert.ok(loaded.has(name), `缺少工作流: ${name}`);
    }
    assert.ok(
      AiStreamLoader.getStats().total >= SYSTEM_CORE_BASELINE.stream,
      `已加载工作流总数 ${AiStreamLoader.getStats().total}`,
    );
  });
});
