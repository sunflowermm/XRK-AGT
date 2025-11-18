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

// 默认调试端口
const DEBUG_PORT = 11451;

async function start() {
  console.log('========================================');
  console.log('          手动调试模式启动          ');
  console.log('========================================');
  console.log(`[+] 启动端口: ${DEBUG_PORT}`);
  console.log('[+] 正在初始化 Bot 核心...');

  try {
    // 模拟服务器启动参数, bot.js/config.js 可能会读取 process.argv
    process.argv.push('server', DEBUG_PORT.toString());

    // 创建 Bot 实例
    const bot = new Bot();
    // 将实例暴露到全局，供 Listener/Plugins 等模块使用
    global.Bot = bot;

    // 运行 Bot
    await bot.run({ port: DEBUG_PORT });

    console.log('[+] Bot 核心已成功启动');
    console.log('========================================');

  } catch (error) {
    console.error('[-] Bot 启动失败:', error);
    process.exit(1);
  }
}

// 全局异常捕获，确保所有错误都能被看到
process.on('uncaughtException', (error) => {
  console.error('[-] 发生未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[-] 发生未处理的 Promise Rejection:', reason);
});

start();
