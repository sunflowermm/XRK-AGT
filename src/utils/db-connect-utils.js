import BotUtil from './botutil.js';
import { exec } from './exec-async.js';
import { normalizeError } from './normalize-error.js';

/**
 * 执行 shell 命令并归一化 stdout/stderr（Redis/MongoDB 本地启动等场景共用）
 * @param {string} cmd
 * @returns {Promise<{ error: Error | null, stdout: string, stderr: string }>}
 */
export async function execCommandResult(cmd) {
  try {
    const { stdout, stderr } = await exec(cmd);
    return {
      error: null,
      stdout: (stdout || '').toString(),
      stderr: (stderr || '').toString()
    };
  } catch (err) {
    const error = normalizeError(err);
    return {
      error,
      stdout: (err.stdout || '').toString?.() ?? String(err.stdout || ''),
      stderr: (err.stderr || '').toString?.() ?? String(err.stderr || '')
    };
  }
}

/**
 * 掩码连接 URL 中的密码
 * @param {string} url
 * @returns {string}
 */
export function maskConnectionUrl(url) {
  return url ? url.replace(/:([^@:]+)@/, ':******@') : url;
}

/**
 * 检测当前系统是否为 ARM64（非 Windows）
 * @returns {Promise<boolean>}
 */
export async function detectArm64() {
  if (process.platform === 'win32') return false;

  try {
    const { stdout } = await execCommandResult('uname -m');
    const archType = stdout.trim();
    return archType.includes('aarch64') || archType.includes('arm64');
  } catch {
    return false;
  }
}

/**
 * 数据库连接最终失败：可选 devHint、XRK_OPTIONAL_DB 抛错，否则 exit(1)
 * @param {string} label
 * @param {unknown} error
 * @param {{ devHint?: string }} [options]
 */
export function finalizeDbConnectionFailure(label, error, options = {}) {
  const normalized = normalizeError(error);
  BotUtil.makeLog('error', `连接失败: ${normalized.message}`, label);
  BotUtil.makeLog('error', '请检查: 1)服务是否启动 2)配置是否正确 3)端口是否可用 4)网络是否正常', label);

  if (process.env.NODE_ENV !== 'production' && options.devHint) {
    BotUtil.makeLog('error', options.devHint, label);
  }

  if (process.env.XRK_OPTIONAL_DB === '1') {
    throw normalized;
  }

  process.exit(1);
}

/**
 * 带重试的数据库 connect 循环（Redis / MongoDB 共用）
 * @param {Object} options
 * @param {string} options.label
 * @param {number} options.maxRetries
 * @param {boolean} options.fastStart
 * @param {string} options.connectionUrl
 * @param {() => { connect: () => Promise<void> }} options.createClient
 * @param {(retryCount: number) => Promise<void>} [options.onBeforeRetry]
 * @param {string} [options.devHint]
 * @returns {Promise<ReturnType<options.createClient>>}
 */
export async function connectWithRetry({
  label,
  maxRetries,
  fastStart,
  connectionUrl,
  createClient,
  onBeforeRetry,
  devHint
}) {
  let client = createClient();
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      BotUtil.makeLog(
        'info',
        `连接中 [${retryCount + 1}/${maxRetries}]: ${maskConnectionUrl(connectionUrl)}`,
        label
      );
      await client.connect();
      BotUtil.makeLog('success', '连接成功', label);
      return client;
    } catch (err) {
      retryCount++;
      const error = normalizeError(err);
      BotUtil.makeLog('warn', `连接失败 [${retryCount}/${maxRetries}]: ${error.message}`, label);

      if (retryCount < maxRetries) {
        if (!fastStart && onBeforeRetry) await onBeforeRetry(retryCount);
        client = createClient();
      } else {
        finalizeDbConnectionFailure(label, error, { devHint });
      }
    }
  }

  return client;
}
