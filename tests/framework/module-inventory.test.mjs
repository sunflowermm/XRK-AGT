import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_CORE_BASELINE, listSystemCoreJs } from '../helpers/system-core.mjs';

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

  it('Tasker', () => {
    assert.equal(listSystemCoreJs('tasker').length, SYSTEM_CORE_BASELINE.tasker);
  });

  it('events', () => {
    assert.equal(listSystemCoreJs('events').length, SYSTEM_CORE_BASELINE.events);
  });
});
