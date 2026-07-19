/**
 * Playwright 目标崩溃识别与安全关闭（不降截图质量，只做恢复路径）
 */

const CRASH_RE =
  /Target crashed|Page crashed|Target closed|has been closed|Browser (has been )?closed|Connection closed|Browser closed|Session closed|Execution context was destroyed/i;

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isPlaywrightCrashError(err) {
  if (err == null) return false;
  const msg = Error.isError(err) ? err.message : String(err);
  return CRASH_RE.test(msg);
}

/**
 * close 可能在崩溃后挂起；超时后放弃等待（进程侧仍可能残留，由下次 launch 隔离）
 * @param {{ close?: () => Promise<unknown> } | null | undefined} target
 * @param {number} [timeoutMs=8000]
 */
export async function softClosePlaywright(target, timeoutMs = 8000) {
  if (!target || typeof target.close !== 'function') return;
  const ms = Math.min(Math.max(Number(timeoutMs) || 8000, 500), 60_000);
  try {
    await Promise.race([
      Promise.resolve(target.close()).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, ms)),
    ]);
  } catch {
    /* ignore */
  }
}

/**
 * 按 page → context → browser 顺序软关闭
 * @param {{ page?: object, context?: object, browser?: object }} [targets]
 * @param {number} [timeoutMs=8000]
 */
export async function softClosePlaywrightTree(targets = {}, timeoutMs = 8000) {
  const { page, context, browser } = targets;
  await softClosePlaywright(page, timeoutMs);
  await softClosePlaywright(context, timeoutMs);
  await softClosePlaywright(browser, timeoutMs);
}
