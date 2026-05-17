import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateApiInstance } from '../../src/infrastructure/http/utils/helpers.js';

const httpDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../core/system-Core/http'
);

const files = fs.readdirSync(httpDir).filter((f) => f.endsWith('.js'));

describe('system-Core HTTP 模块结构', () => {
  for (const file of files) {
    it(`${file} 导出有效 HttpApi 结构`, async () => {
      const mod = await import(pathToFileURL(path.join(httpDir, file)).href);
      const api = mod.default;
      assert.ok(validateApiInstance(api, file), file);
      assert.ok(api.routes.length > 0, `${file} 无路由`);
      for (const route of api.routes) {
        assert.ok(route.method && route.path && route.handler, `${file} 路由不完整`);
      }
    });
  }
});
