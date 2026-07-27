import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROJECT_RULES_DIR_REL,
  PROJECT_SKILLS_STANDARD_REL,
  WORKSPACE_BUNDLE_DIR_REL,
  LONG_TERM_MEMORY_REL,
} from '../../src/utils/agent-workspace-paths.js';
import paths from '../../src/utils/paths.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('agents/ 仓库布局', () => {
  it('规则 / 技能种子 / 工作区模板均在 agents/ 下', () => {
    for (const rel of [PROJECT_RULES_DIR_REL, PROJECT_SKILLS_STANDARD_REL, WORKSPACE_BUNDLE_DIR_REL]) {
      assert.ok(rel.startsWith('agents/'), rel);
      assert.ok(fs.existsSync(path.join(root, rel)), rel);
    }
    assert.ok(fs.existsSync(path.join(root, WORKSPACE_BUNDLE_DIR_REL, LONG_TERM_MEMORY_REL)));
  });

  it('根目录不再平铺 rules/skills/memory/www', () => {
    for (const name of ['rules', 'skills', 'memory', 'www']) {
      assert.equal(fs.existsSync(path.join(root, name)), false, name);
    }
  });
});

describe('站点根静态', () => {
  it('paths.www 指向 system-Core/site', () => {
    const expected = path.join(root, 'core', 'system-Core', 'site');
    assert.equal(path.normalize(paths.www), path.normalize(expected));
    assert.ok(fs.existsSync(paths.www));
  });
});
