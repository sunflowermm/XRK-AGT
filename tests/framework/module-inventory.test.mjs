import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_CORE_BASELINE, SYSTEM_CORE_DIR, listSystemCoreJs } from '../helpers/system-core.mjs';
import { SYSTEM_CORE_VENDOR_PLUGINS } from '../../src/utils/loader-constants.js';

describe('system-Core 模块数量（框架基准）', () => {
  it('HTTP API', () => {
    assert.equal(listSystemCoreJs('http').length, SYSTEM_CORE_BASELINE.http);
  });

  it('AI 工作流', () => {
    assert.equal(listSystemCoreJs('stream').length, SYSTEM_CORE_BASELINE.stream);
  });

  it('内置插件', () => {
    assert.equal(listSystemCoreJs('plugin').length, SYSTEM_CORE_BASELINE.plugin);
  });

  it('vendor 插件不计入官方基准', () => {
    const pluginDir = path.join(SYSTEM_CORE_DIR, 'plugin');
    const all = fs.readdirSync(pluginDir).filter((f) => f.endsWith('.js'));
    const official = listSystemCoreJs('plugin');
    assert.equal(official.length, SYSTEM_CORE_BASELINE.plugin);
    for (const vendor of SYSTEM_CORE_VENDOR_PLUGINS) {
      if (!all.includes(vendor)) continue;
      assert.ok(!official.includes(vendor), `${vendor} 不应计入基准`);
      assert.ok(all.length > official.length);
    }
  });

  it('Tasker', () => {
    assert.equal(listSystemCoreJs('tasker').length, SYSTEM_CORE_BASELINE.tasker);
  });

  it('events', () => {
    assert.equal(listSystemCoreJs('events').length, SYSTEM_CORE_BASELINE.events);
  });
});
