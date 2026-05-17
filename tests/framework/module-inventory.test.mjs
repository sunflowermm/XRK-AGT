import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
}

describe('system-Core 模块数量（与文档一致）', () => {
  it('HTTP API 为 11 个', () => {
    const httpDir = path.join(root, 'core/system-Core/http');
    const files = listJsFiles(httpDir);
    assert.equal(files.length, 11, `http 目录文件: ${files.join(', ')}`);
  });

  it('AI 工作流为 9 个（含 screen、react-bits-mcp）', () => {
    const streamDir = path.join(root, 'core/system-Core/stream');
    const files = listJsFiles(streamDir);
    assert.equal(files.length, 9, `stream 目录文件: ${files.join(', ')}`);
  });
});
