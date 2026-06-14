/**
 * @file debug.js
 * @description 手动调试启动脚本
 *
 * 使用方法:
 * 1. 在终端中直接运行 `node debug.js`
 * 2. 脚本会直接启动 Bot 核心，不经过 app.js 的依赖检查和进程守护
 * 3. 所有错误和日志都会直接输出到控制台，方便调试
 */

import Bot from './src/bot.js';
import { setRuntimeGlobal } from './src/utils/runtime-globals.js';

const DEBUG_PORT = 11451;

async function start() {
  console.log('========================================');
  console.log('          手动调试模式启动          ');
  console.log('========================================');
  console.log(`[+] 启动端口: ${DEBUG_PORT}`);
  console.log('[+] 正在初始化 Bot 核心...');

  try {
    process.argv.push('server', DEBUG_PORT.toString());

    const bot = new Bot();
    setRuntimeGlobal('Bot', bot);

    await bot.run({ port: DEBUG_PORT });

    console.log('[+] Bot 核心已成功启动');
    console.log('========================================');
  } catch (error) {
    console.error('[-] Bot 启动失败:', error);
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  console.error('[-] 发生未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[-] 发生未处理的 Promise Rejection:', reason);
  process.exit(1);
});

start();
