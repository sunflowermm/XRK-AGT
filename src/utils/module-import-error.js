/**
 * 分类 Node ESM / CJS 模块加载失败，供插件 Loader、API Loader、审计测试共用。
 * @param {unknown} err
 * @returns {{
 *   kind: 'missing_package' | 'missing_export' | 'other',
 *   packageName?: string,
 *   exportName?: string,
 *   message: string
 * }}
 */
export function classifyModuleImportError(err) {
  const message = isErrorLike(err) ? err.message : String(err ?? '');
  const stack = isErrorLike(err) && typeof err.stack === 'string' ? err.stack : '';
  const text = `${message}\n${stack}`;

  let m = text.match(/Cannot find package ['"]([^'"]+)['"]/i);
  if (m) {
    return { kind: 'missing_package', packageName: m[1], message };
  }

  m = text.match(/Cannot find module ['"]([^'"]+)['"]/i);
  if (m) {
    return {
      kind: 'missing_package',
      packageName: normalizePackageSpecifier(m[1]),
      message
    };
  }

  m = text.match(/does not provide an export named ['"]([^'"]+)['"]/i);
  if (m) {
    const mod = text.match(/requested module ['"]([^'"]+)['"]/i);
    return {
      kind: 'missing_export',
      exportName: m[1],
      packageName: mod?.[1],
      message
    };
  }

  return { kind: 'other', message };
}

/** @param {unknown} err @returns {err is { message: string, stack?: string }} */
function isErrorLike(err) {
  if (typeof Error.isError === 'function') return Error.isError(err);
  return Boolean(err && typeof err === 'object' && typeof /** @type {{ message?: unknown }} */ (err).message === 'string');
}

/**
 * @param {string} spec
 * @returns {string}
 */
function normalizePackageSpecifier(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#') || pathIsAbsolute(spec)) {
    return spec;
  }
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0] || spec;
}

/** @param {string} p */
function pathIsAbsolute(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/**
 * @param {unknown} err
 * @returns {string | null}
 */
export function extractMissingPackageName(err) {
  const c = classifyModuleImportError(err);
  return c.kind === 'missing_package' ? (c.packageName || null) : null;
}

/**
 * 是否应归入「缺少 npm 依赖」提示（而非普通代码错误）
 * @param {unknown} err
 */
export function isMissingPackageError(err) {
  return classifyModuleImportError(err).kind === 'missing_package';
}
