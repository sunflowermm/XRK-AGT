import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { InputValidator } from '../../src/utils/input-validator.js';
import { RuntimeError } from '../../src/utils/error-handler.js';

const dataRoot = path.join(process.cwd(), 'data');

describe('InputValidator 路径安全', () => {
  it('允许 data 根下相对路径', () => {
    const resolved = InputValidator.validatePath('server_bots/test.yaml', dataRoot);
    assert.ok(resolved.includes('server_bots'));
  });

  it('拒绝路径穿越', () => {
    assert.throws(
      () => InputValidator.validatePath('../../../etc/passwd', dataRoot),
      RuntimeError
    );
  });

  it('拒绝绝对路径', () => {
    assert.throws(
      () => InputValidator.validatePath('/etc/passwd', dataRoot),
      RuntimeError
    );
  });
});
