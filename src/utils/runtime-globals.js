/**
 * 运行时全局挂载（globalThis）
 * - Node ESM 下业务代码裸写 AgentRuntime / msgSegment / runtimeConfig 等即解析于此
 * - 见 docs/runtime-surface.md「全局标识符写法」
 */
export function setRuntimeGlobal(name, value) {
  globalThis[name] = value;
}

/** @template T @param {string} name @returns {T | undefined} */
export function getRuntimeGlobal(name) {
  return globalThis[name];
}

/** 进程 shutdown 标志（基础设施内部） */
export function isShuttingDown() {
  return globalThis.__xrkShuttingDown === true;
}

export function setShuttingDown(value = true) {
  globalThis.__xrkShuttingDown = Boolean(value);
}

/** 一次性进程标志（信号/error handler 等） */
export function isProcessFlagSet(name) {
  return globalThis[name] === true;
}

export function setProcessFlag(name, value = true) {
  globalThis[name] = value;
}
