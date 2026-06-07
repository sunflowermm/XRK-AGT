/**
 * AI 聊天侧栏：LLM 工厂 ↔ API 端点联动
 * vendors 由 /api/ai/models（LLMFactory.listVendors）统一提供
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

/**
 * @returns {{ factoryId: string, endpointKey: string, changed: boolean }}
 */
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
  } catch {}
}

export function renderAiEndpointOptions(escapeHtml, vendors, factoryId, selectedKey = '') {
  if (!factoryId) {
    return '<option value="" selected>请先选择 LLM 工厂</option>';
  }
  const endpoints = getVendorEndpoints(vendors, factoryId);
  if (!endpoints.length) {
    return '<option value="" selected>该工厂暂无已配置端点</option>';
  }
  const parts = [`<option value=""${selectedKey ? '' : ' selected'}>继承 aistream 默认</option>`];
  for (const ep of endpoints) {
    const label = ep.label || ep.key;
    const modelHint = ep.model ? ` · ${ep.model}` : '';
    const fullText = `${label}${modelHint}`;
    const selected = selectedKey === ep.key ? ' selected' : '';
    parts.push(
      `<option value="${escapeHtml(ep.key)}" title="${escapeHtml(fullText)}"${selected}>${escapeHtml(label)}</option>`
    );
  }
  return parts.join('');
}

export function syncAiEndpointMeta(llmOptions = {}, factoryId = '', endpointKey = '') {
  const meta = document.getElementById('aiEndpointMeta');
  if (!meta) return;

  if (!factoryId) {
    meta.textContent = '先选择 LLM 工厂，再选择该工厂下的 API 端点（providers[]）';
    return;
  }

  const vendors = getLlmVendors(llmOptions);
  const vendor = vendors.find((v) => v.id === factoryId);
  const endpoints = vendor?.endpoints || [];

  if (!endpoints.length) {
    meta.textContent = `工厂「${vendor?.label || factoryId}」暂无端点，请先在配置管理中添加 providers`;
    return;
  }

  if (!endpointKey) {
    const def = llmOptions.defaultProfile || '';
    meta.textContent = def
      ? `未指定端点时将使用 aistream.llm.Provider（${def}）`
      : '未指定端点时将使用 aistream.llm.Provider 或运行时默认';
    return;
  }

  const profile = (llmOptions.profiles || []).find((p) => p.key === endpointKey);
  if (!profile) {
    meta.textContent = `端点：${endpointKey}`;
    return;
  }
  const parts = [
    profile.factory ? `工厂 ${profile.factory}` : null,
    profile.model ? `模型 ${profile.model}` : null,
    profile.baseUrl || null
  ].filter(Boolean);
  meta.textContent = parts.join(' · ') || `端点：${endpointKey}`;
}

export function refreshAiEndpointSelect(app, factoryId, selectedKey = '') {
  const select = document.getElementById('aiProviderSelect');
  if (!select) return;
  const vendors = getLlmVendors(app._llmOptions || {});
  select.disabled = !factoryId || !getVendorEndpoints(vendors, factoryId).length;
  select.innerHTML = renderAiEndpointOptions(
    (v) => app.escapeHtml(v),
    vendors,
    factoryId,
    selectedKey
  );
  syncAiEndpointMeta(app._llmOptions || {}, factoryId, select.value);
}

/** 发送前校验：端点必须属于当前所选工厂 */
export function validateChatProviderForFactory(llmOptions, settings = {}) {
  const factoryId = settings.llmFactory || '';
  const endpointKey = settings.provider || '';
  if (!factoryId || !endpointKey) return endpointKey;
  const endpoints = getVendorEndpoints(getLlmVendors(llmOptions), factoryId);
  return endpoints.some((e) => e.key === endpointKey) ? endpointKey : '';
}
