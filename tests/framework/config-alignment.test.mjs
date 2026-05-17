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
const systemJsPath = path.join(root, 'core/system-Core/commonconfig/system.js');

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

describe('配置三件套：默认模板存在', () => {
  for (const name of [...GLOBAL_CONFIGS, ...SERVER_CONFIGS]) {
    it(`${name}.yaml 存在于 config/default_config`, () => {
      const file = path.join(defaultConfigDir, `${name}.yaml`);
      assert.ok(fs.existsSync(file), `缺少默认模板: ${file}`);
    });
  }
});

describe('system.js schema 覆盖全局与端口配置段', () => {
  const systemSrc = readText(systemJsPath);
  for (const name of [...GLOBAL_CONFIGS, ...SERVER_CONFIGS]) {
    it(`schema 含 ${name} 段`, () => {
      assert.match(systemSrc, new RegExp(`\\b${name}:\\s*\\{`));
    });
  }
});
