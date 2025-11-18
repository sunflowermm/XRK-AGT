/**
 * @file manual-start.js
 * @description 手动启动指定端口的机器人实例
 * @author Cascade
 *
 * 使用方法:
 * 1. 修改下面的 `MANUAL_PORT`为你想要启动的端口号。
 * 2. 在终端运行 `node manual-start.js`。
 */

import Bot from '#bot';

// ===================================
// 在这里配置您想手动启动的端口号
const MANUAL_PORT = 11451;
// ===================================

/**
 * 简易日志记录器
 * @param {string} level 日志级别 (info, error, success)
 * @param {string} message 日志消息
 */
const log = (level, message) => {
  const colors = {
    info: '\x1b[36m',
    error: '\x1b[31m',
    success: '\x1b[32m',
  };
  const color = colors[level] || '\x1b[0m';
  console.log(`${color}[ManualStart] ${message}\x1b[0m`);
};

/**
 * 主启动函数
 */
async function main() {
  log('info', `准备手动启动机器人，端口: ${MANUAL_PORT}...`);

  try {
    // 设置必要的环境变量，以便应用内的其他模块能够识别运行模式
    process.env.XRK_SELECTED_MODE = 'server';
    process.env.XRK_SERVER_PORT = MANUAL_PORT.toString();

    // 创建Bot实例
    const bot = new Bot();

    // 运行Bot
    // bot.run() 方法会处理所有必要的加载和初始化流程
    await bot.run({ port: MANUAL_PORT });

    log('success', `机器人已在端口 ${MANUAL_PORT} 成功启动。`);

  } catch (error) {
    log('error', `启动失败: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// 捕获未处理的异常，确保程序在出错时能干净地退出
process.on('uncaughtException', (error) => {
  log('error', `捕获到未处理的异常: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  const errorMessage = reason instanceof Error ? reason.stack : String(reason);
  log('error', `捕获到未处理的Promise拒绝: ${errorMessage}`);
  process.exit(1);
});

// 启动
main();

