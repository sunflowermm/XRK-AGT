/**
 * 多租户 / Core 命名空间辅助
 * 集合名格式：<owner>_<entity>，由 registerCollection 统一生成
 */

/** @param {string} owner @param {string} entity */
export function tenantCollectionName(owner, entity) {
  const o = String(owner || '').trim();
  const e = String(entity || '').trim();
  if (!o || !e) throw new Error('[mongodb-Core] tenantCollectionName 参数无效');
  return `${o}_${e}`;
}

/**
 * 为查询注入 owner 隔离字段（可选，业务文档含 owner 字段时使用）
 * @param {string} owner
 * @param {Record<string, unknown>} [filter]
 */
export function tenantScope(owner, filter = {}) {
  return { ...filter, _owner: String(owner) };
}

/**
 * 写入时附加租户元数据
 * @param {string} owner
 * @param {Record<string, unknown>} doc
 */
export function withTenantMeta(owner, doc) {
  return {
    ...doc,
    _owner: String(owner),
    _updatedAt: new Date(),
  };
}
