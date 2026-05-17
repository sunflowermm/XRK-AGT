import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_CORE_BASELINE,
  listSystemCoreJs,
} from '../helpers/system-core.mjs';

describe('system-Core 模块数量（框架基准）', () => {
  it('HTTP API 为 11 个', () => {
    const files = listSystemCoreJs('http');
    assert.equal(files.length, SYSTEM_CORE_BASELINE.http, files.join(', '));
  });

  it('AI 工作流为 7 个（不含 screen / react-bits-mcp）', () => {
    const files = listSystemCoreJs('stream');
    assert.equal(files.length, SYSTEM_CORE_BASELINE.stream, files.join(', '));
  });

  it('内置插件为 15 个（不含远行商人）', () => {
    const files = listSystemCoreJs('plugin');
    assert.equal(files.length, SYSTEM_CORE_BASELINE.plugin, files.join(', '));
  });

  it('Tasker 为 4 个', () => {
    const files = listSystemCoreJs('tasker');
    assert.equal(files.length, SYSTEM_CORE_BASELINE.tasker, files.join(', '));
  });

  it('events 监听器为 3 个', () => {
    const files = listSystemCoreJs('events');
    assert.equal(files.length, SYSTEM_CORE_BASELINE.events, files.join(', '));
  });
});
