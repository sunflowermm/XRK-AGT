import { EventEmitter } from 'node:events';

export async function bootstrapTestEnv() {
  process.env.XRK_TEST = '1';
  if (!global.logger) {
    const setLog = (await import('../../src/infrastructure/log.js')).default;
    setLog();
  }
  if (!global.Bot || typeof global.Bot.on !== 'function') {
    const stub = new EventEmitter();
    stub.makeLog = () => {};
    stub.tasker = [];
    stub.mkdir = async () => {};
    stub.em = () => stub;
    global.Bot = stub;
    globalThis.Bot = stub;
  }
}
