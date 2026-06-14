import { EventEmitter } from 'node:events';
import { setRuntimeGlobal, getRuntimeGlobal } from '../../src/utils/runtime-globals.js';

export async function bootstrapTestEnv() {
  process.env.XRK_TEST = '1';
  await import('../../src/bootstrap-globals.js');
  if (!getRuntimeGlobal('logger')) {
    const setLog = (await import('../../src/infrastructure/log.js')).default;
    setLog();
  }
  const bot = getRuntimeGlobal('Bot');
  if (!bot || typeof bot.on !== 'function') {
    const stub = new EventEmitter();
    stub.makeLog = () => {};
    stub.tasker = [];
    stub.mkdir = async () => {};
    stub.em = () => stub;
    setRuntimeGlobal('Bot', stub);
  }
}
