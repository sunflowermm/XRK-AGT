import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GLOBAL_CONFIGS,
  SERVER_CONFIGS
} from '../../src/infrastructure/config/config-constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultConfigDir = path.join(root, 'config/default_config');
const commonconfigDir = path.join(root, 'core/system-Core/commonconfig');
/** system.js 门面 + system-*.js 分域 schema（split 后段字段不再集中在一个文件） */
const systemSrc = fs.readdirSync(commonconfigDir)
  .filter((f) => /^system(?:-[a-z0-9-]+)?\.js$/i.test(f))
  .map((f) => fs.readFileSync(path.join(commonconfigDir, f), 'utf8'))
  .join('\n');
const allConfigNames = [...GLOBAL_CONFIGS, ...SERVER_CONFIGS];

describe('配置三件套：默认模板与 system.js schema', () => {
  for (const name of allConfigNames) {
    it(`${name} 模板存在且 schema 含 ${name} 段`, () => {
      const file = path.join(defaultConfigDir, `${name}.yaml`);
      assert.ok(fs.existsSync(file), `缺少默认模板: ${file}`);
      // 兼容：整文件巨石 `name: {`，或分域后的 `name: nameConfig` / `export const nameConfig`
      const ok =
        new RegExp(`\\b${name}:\\s*\\{`).test(systemSrc) ||
        new RegExp(`\\b${name}:\\s*${name}Config\\b`).test(systemSrc) ||
        new RegExp(`export\\s+const\\s+${name}Config\\b`).test(systemSrc);
      assert.ok(ok, `system 分域 schema 中未找到 ${name} 段`);
    });
  }
});
