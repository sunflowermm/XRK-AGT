import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyModuleImportError,
  extractMissingPackageName,
  isMissingPackageError
} from '../../src/utils/module-import-error.js';
import * as database from '../../src/infrastructure/database/index.js';

describe('module-import-error 分类', () => {
  it('识别 Cannot find package', () => {
    const err = new Error("Cannot find package 'mongodb' imported from C:\\x\\init.js");
    err.stack = `Error: Cannot find package 'mongodb' imported from C:\\x\\init.js\n    at ...`;
    const c = classifyModuleImportError(err);
    assert.equal(c.kind, 'missing_package');
    assert.equal(c.packageName, 'mongodb');
    assert.equal(extractMissingPackageName(err), 'mongodb');
    assert.equal(isMissingPackageError(err), true);
  });

  it('识别 scoped 包名', () => {
    const err = new Error("Cannot find package '@qdrant/js-client-rest' imported from ./client.js");
    assert.equal(extractMissingPackageName(err), '@qdrant/js-client-rest');
  });

  it('识别缺失 named export（非缺依赖）', () => {
    const err = new Error(
      "The requested module '#infrastructure/database/index.js' does not provide an export named 'getMongoDb'"
    );
    const c = classifyModuleImportError(err);
    assert.equal(c.kind, 'missing_export');
    assert.equal(c.exportName, 'getMongoDb');
    assert.equal(c.packageName, '#infrastructure/database/index.js');
    assert.equal(isMissingPackageError(err), false);
    assert.equal(extractMissingPackageName(err), null);
  });

  it('首个引号误匹配回退：导出错误不得当成依赖名', () => {
    // 旧 packageTips 用 stack.match(/'(.+?)'/) 会把 #infrastructure/... 当成「缺少依赖」
    const err = new Error(
      "The requested module '#infrastructure/database/index.js' does not provide an export named 'getMongoDb'"
    );
    err.stack = err.message;
    assert.notEqual(extractMissingPackageName(err), '#infrastructure/database/index.js');
  });
});

describe('Runtime database 导出契约', () => {
  it('仅暴露 Redis，不导出 getMongoDb', () => {
    assert.equal(typeof database.getRedis, 'function');
    assert.equal(typeof database.getDatabaseManager, 'function');
    assert.equal(typeof database.initDatabases, 'function');
    assert.equal('getMongoDb' in database, false);
    assert.equal(database.getMongoDb, undefined);
  });
});
