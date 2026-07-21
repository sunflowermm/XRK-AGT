import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RESERVED_ROOT_SEGMENTS } from '../../src/infrastructure/http/mount-core-www.js';
import {
  isActiveFrontendSign,
  readWwwSignFile,
  resolveWwwAppMount,
  resolveWwwAppStaticRoot,
  resolveWwwPublicMountPath,
  resolveWwwStaticRoot,
  shouldProxyFrontend,
} from '../../src/infrastructure/http/www-app-resolve.js';

describe('mount-core-www 保留根段', () => {
  it('含框架与历史冲突名 shared', () => {
    for (const seg of ['api', 'core', 'media', 'uploads', 'File', 'shared']) {
      assert.ok(RESERVED_ROOT_SEGMENTS.includes(seg), seg);
    }
  });
});

describe('www-app-resolve', () => {
  /** @returns {string} */
  function tmpApp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'xrk-www-app-'));
  }

  function writeSign(dir, obj) {
    fs.writeFileSync(path.join(dir, 'sign.json'), JSON.stringify(obj));
  }

  it('shouldProxyFrontend：enabled false / serve static 不反代', () => {
    assert.equal(shouldProxyFrontend(null), false);
    assert.equal(shouldProxyFrontend({ enabled: false }), false);
    assert.equal(shouldProxyFrontend({ enabled: true, serve: 'static' }), false);
    assert.equal(shouldProxyFrontend({ enabled: true, serve: 'dist' }), false);
    assert.equal(shouldProxyFrontend({ enabled: true }), true);
    assert.equal(shouldProxyFrontend({ enabled: true, serve: 'proxy' }), true);
  });

  it('普通静态：无 sign → URL=目录名，不挂 dist', () => {
    const parent = tmpApp();
    const appDir = path.join(parent, 'xrk');
    fs.mkdirSync(appDir);
    const dist = path.join(appDir, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(appDir, 'index.html'), '<html>root</html>');

    const d = resolveWwwAppMount(appDir);
    assert.equal(d.kind, 'plain');
    assert.equal(d.mode, 'static');
    assert.equal(d.mountPath, '/xrk');
    assert.equal(d.staticRoot, appDir);
    assert.equal(resolveWwwPublicMountPath('xrk', null), '/xrk');
    assert.equal(resolveWwwAppStaticRoot(appDir), appDir);

    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('前端工程：proxy.mount 优先于目录名，静态挂 dist', () => {
    assert.equal(
      resolveWwwPublicMountPath('frontend-example', {
        id: 'example',
        proxy: { mount: '/example' },
      }),
      '/example'
    );
    assert.equal(
      resolveWwwPublicMountPath('frontend-example', { id: 'example' }),
      '/example'
    );

    const parent = tmpApp();
    const appDir = path.join(parent, 'frontend-example');
    fs.mkdirSync(appDir);
    writeSign(appDir, {
      enabled: false,
      serve: 'static',
      id: 'example',
      proxy: { mount: '/example' },
    });
    fs.mkdirSync(path.join(appDir, 'dist'));
    fs.writeFileSync(path.join(appDir, 'dist', 'index.html'), '<html></html>');
    const d = resolveWwwAppMount(appDir);
    assert.equal(d.kind, 'signed');
    assert.equal(d.mountPath, '/example');
    assert.equal(d.mode, 'static');
    assert.equal(d.staticRoot, path.join(appDir, 'dist'));
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('sign 损坏时回退普通静态', () => {
    const dir = tmpApp();
    fs.writeFileSync(path.join(dir, 'sign.json'), '{not-json');
    const read = readWwwSignFile(path.join(dir, 'sign.json'));
    assert.equal(read.ok, false);
    assert.equal(isActiveFrontendSign(path.join(dir, 'sign.json')), false);
    const d = resolveWwwAppMount(dir);
    assert.equal(d.kind, 'plain');
    assert.equal(d.mode, 'static');
    assert.equal(d.staticRoot, dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('enabled:false + dist → 静态挂 dist', () => {
    const dir = tmpApp();
    writeSign(dir, { enabled: false, id: 't' });
    const dist = path.join(dir, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    const d = resolveWwwAppMount(dir);
    assert.equal(d.kind, 'signed');
    assert.equal(d.mode, 'static');
    assert.equal(d.staticRoot, dist);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serve:static 即使 enabled true 也静态', () => {
    const dir = tmpApp();
    writeSign(dir, { enabled: true, serve: 'static', id: 't' });
    const dist = path.join(dir, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    const d = resolveWwwAppMount(dir);
    assert.equal(d.kind, 'signed');
    assert.equal(d.mode, 'static');
    assert.equal(d.staticRoot, dist);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('enabled true 默认 proxy', () => {
    const dir = tmpApp();
    writeSign(dir, { enabled: true, id: 't', command: 'pnpm', port: 1 });
    const d = resolveWwwAppMount(dir);
    assert.equal(d.kind, 'signed');
    assert.equal(d.mode, 'proxy');
    assert.equal(d.staticRoot, null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('staticRoot 自定义且防目录穿越', () => {
    const dir = tmpApp();
    const custom = path.join(dir, 'release');
    fs.mkdirSync(custom);
    fs.writeFileSync(path.join(custom, 'index.html'), '<html></html>');
    assert.equal(resolveWwwStaticRoot(dir, { staticRoot: 'release' }).root, custom);

    const r = resolveWwwStaticRoot(dir, { staticRoot: '../outside' });
    assert.equal(r.root, dir);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('前端工程无 dist 的 Vite 源码树给出 warn', () => {
    const dir = tmpApp();
    writeSign(dir, { enabled: false, serve: 'static', id: 't' });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
    fs.writeFileSync(path.join(dir, 'vite.config.js'), 'export default {}');
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<script type="module" src="/src/main.js"></script>'
    );
    const r = resolveWwwStaticRoot(dir, { enabled: false, serve: 'static' });
    assert.equal(r.root, dir);
    assert.ok(r.warn && /dist/i.test(r.warn));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
