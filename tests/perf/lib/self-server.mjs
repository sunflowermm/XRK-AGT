/**
 * 自举临时 AgentRuntime（XRK_TEST=1）供压测脚本使用
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const helper = path.join(root, 'tests/helpers/test-server.mjs');

export function pickPort() {
  return 19000 + Math.floor(Math.random() * 800);
}

/**
 * @param {{ port?: number, timeoutMs?: number, env?: Record<string, string> }} [opts]
 */
export async function startSelfServer(opts = {}) {
  const port = opts.port ?? pickPort();
  const timeoutMs = opts.timeoutMs ?? 150_000;
  const child = spawn(process.execPath, [helper], {
    cwd: root,
    env: {
      ...process.env,
      ...opts.env,
      XRK_TEST_PORT: String(port),
      XRK_TEST: '1',
      XRK_FAST_START: process.env.XRK_FAST_START || '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let errBuf = '';
  child.stderr?.on('data', (c) => {
    errBuf += c.toString();
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`self-server boot timeout\n${errBuf.slice(-4000)}`)), timeoutMs);
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes('XRK_TEST_READY')) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.on('exit', (code) => {
      if (!buf.includes('XRK_TEST_READY')) {
        clearTimeout(timer);
        reject(new Error(`self-server exited early: ${code}\n${errBuf.slice(-4000)}`));
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    async stop() {
      if (!child || child.killed) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          resolve();
        }, 8000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
