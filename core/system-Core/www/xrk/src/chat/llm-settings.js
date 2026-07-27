/**
 * AI 聊天：LLM 工厂 ↔ API 端点联动（对齐原 ai-llm-settings.js）
 */

export function getLlmVendors(llmOptions = {}) {
  return llmOptions.vendors ?? [];
}

export function findVendorForEndpoint(vendors, endpointKey) {
  if (!endpointKey) return null;
  return vendors.find((v) => v.endpoints?.some((e) => e.key === endpointKey)) || null;
}

export function getVendorEndpoints(vendors, factoryId) {
  if (!factoryId) return [];
  return vendors.find((v) => v.id === factoryId)?.endpoints || [];
}

/** @returns {{ factoryId: string, endpointKey: string, changed: boolean }} */
export function resolveAiLlmSelection(vendors, settings = {}) {
  const savedFactory = settings.llmFactory || '';
  const savedProvider = settings.provider || '';
  let factoryId = savedFactory;
  let endpointKey = '';
  let changed = false;

  if (factoryId) {
    const endpoints = getVendorEndpoints(vendors, factoryId);
    if (savedProvider && endpoints.some((e) => e.key === savedProvider)) {
      endpointKey = savedProvider;
    } else if (savedProvider) {
      changed = true;
    }
  } else if (savedProvider) {
    const hit = findVendorForEndpoint(vendors, savedProvider);
    if (hit) {
      factoryId = hit.id;
      endpointKey = savedProvider;
      changed = true;
    } else {
      changed = true;
    }
  }

  return { factoryId, endpointKey, changed };
}

export function persistAiLlmSelection(settings, { factoryId, endpointKey }) {
  settings.llmFactory = factoryId || '';
  settings.provider = endpointKey || '';
  try {
    localStorage.setItem('chatLlmFactory', settings.llmFactory);
    localStorage.setItem('chatProvider', settings.provider);
  } catch {
    /* ignore */
  }
}

export function validateChatProviderForFactory(llmOptions, settings = {}) {
  const factoryId = settings.llmFactory || '';
  const endpointKey = settings.provider || '';
  if (!factoryId || !endpointKey) return endpointKey;
  const endpoints = getVendorEndpoints(getLlmVendors(llmOptions), factoryId);
  return endpoints.some((e) => e.key === endpointKey) ? endpointKey : '';
}

export function endpointMetaText(llmOptions = {}, factoryId = '', endpointKey = '') {
  if (!factoryId) return '先选择 LLM 工厂，再选择该工厂下的 API 端点（providers[]）';
  const vendors = getLlmVendors(llmOptions);
  const vendor = vendors.find((v) => v.id === factoryId);
  const endpoints = vendor?.endpoints || [];
  if (!endpoints.length) {
    return `工厂「${vendor?.label || factoryId}」暂无端点，请先在配置管理中添加 providers`;
  }
  if (!endpointKey) {
    const def = llmOptions.defaultProfile || '';
    return def
      ? `未指定端点时将使用 ai-workflow.llm.Provider（${def}）`
      : '未指定端点时将使用 ai-workflow.llm.Provider 或运行时默认';
  }
  const profile = (llmOptions.profiles || []).find((p) => p.key === endpointKey);
  if (!profile) return `端点：${endpointKey}`;
  return (
    [profile.factory ? `工厂 ${profile.factory}` : null, profile.model ? `模型 ${profile.model}` : null, profile.baseUrl || null]
      .filter(Boolean)
      .join(' · ') || `端点：${endpointKey}`
  );
}

export function normalizeWorkspaceId(id) {
  const s = String(id || '').trim();
  return s || 'default';
}
