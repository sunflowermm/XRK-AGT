import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_CORE_BASELINE, listSystemCoreJs } from '../helpers/system-core.mjs';

describe('system-Core 模块数量（框架基准）', () => {
  for (const [subdir, expected] of Object.entries(SYSTEM_CORE_BASELINE)) {
    it(`${subdir} = ${expected}`, () => {
      assert.equal(listSystemCoreJs(subdir).length, expected);
    });
  }
});
