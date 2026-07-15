import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateApiInstance } from '../../src/infrastructure/http/utils/helpers.js';
import { SYSTEM_CORE_DIR, listSystemCoreJs } from '../helpers/system-core.mjs';

describe('system-Core HTTP 模块结构', () => {
  for (const file of listSystemCoreJs('http')) {
    it(`${file} 导出有效 HttpApi 结构`, async () => {
      const mod = await import(pathToFileURL(path.join(SYSTEM_CORE_DIR, 'http', file)).href);
      const api = mod.default;
      assert.ok(validateApiInstance(api, file), file);
      assert.ok(api.routes.length > 0, `${file} 无路由`);
      for (const route of api.routes) {
        assert.ok(route.method && route.path && route.handler, `${file} 路由不完整`);
      }
    });
  }
});
