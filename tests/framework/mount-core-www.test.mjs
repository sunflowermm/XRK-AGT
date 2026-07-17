import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESERVED_ROOT_SEGMENTS } from '../../src/infrastructure/http/mount-core-www.js';

describe('mount-core-www 保留根段', () => {
  it('含框架与历史冲突名 shared', () => {
    for (const seg of ['api', 'core', 'media', 'uploads', 'File', 'shared']) {
      assert.ok(RESERVED_ROOT_SEGMENTS.includes(seg), seg);
    }
  });
});
