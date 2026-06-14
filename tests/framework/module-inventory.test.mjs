import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_CORE_BASELINE, SYSTEM_CORE_DIR, listSystemCoreJs } from '../helpers/system-core.mjs';

describe('system-Core 模块数量（框架基准）', () => {
  it('HTTP API', () => {
    assert.equal(listSystemCoreJs('http').length, SYSTEM_CORE_BASELINE.http);
  });

  it('AI 工作流', () => {
    assert.equal(listSystemCoreJs('stream').length, SYSTEM_CORE_BASELINE.stream);
  });

  it('内置插件（git 入库）', () => {
    assert.equal(listSystemCoreJs('plugin').length, SYSTEM_CORE_BASELINE.plugin);
  });

  it('未入库 plugin 不计入基准', () => {
    const pluginDir = path.join(SYSTEM_CORE_DIR, 'plugin');
    const onDisk = fs.readdirSync(pluginDir).filter((f) => f.endsWith('.js'));
    const official = listSystemCoreJs('plugin');
    assert.equal(official.length, SYSTEM_CORE_BASELINE.plugin);
    assert.ok(onDisk.length >= official.length);
  });

  it('Tasker', () => {
    assert.equal(listSystemCoreJs('tasker').length, SYSTEM_CORE_BASELINE.tasker);
  });

  it('events', () => {
    assert.equal(listSystemCoreJs('events').length, SYSTEM_CORE_BASELINE.events);
  });
});
