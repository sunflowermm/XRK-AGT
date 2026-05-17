/**
 * 测试专用启动脚本（由 server-e2e 子进程调用）
 */
process.env.XRK_TEST = '1';

import Bot from '../../src/bot.js';

const port = Number(process.env.XRK_TEST_PORT);
if (!Number.isFinite(port) || port <= 0) {
  console.error('XRK_TEST_PORT required');
  process.exit(2);
}

const bot = new Bot();
global.Bot = bot;

async function shutdown() {
  try {
    await bot.closeServer();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  await bot.run({ port });
  process.stdout.write('XRK_TEST_READY\n');
} catch (err) {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
}
