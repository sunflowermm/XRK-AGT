/**
 * LLM provider 条目在配置页的展示分组。
 * - 顺序即渲染顺序；字段 schema 仍以 commonconfig/shared/llm-provider-fields.js 为准
 * - collapsible: true 的组用 <details> 折叠，减少单条 provider 纵向占用
 * - groupProviderSchemaFields 会追加 schema 中存在但未列出的字段到「其他」
 */
export const LLM_PROVIDER_FIELD_GROUPS = [
  {
    id: 'identity',
    label: '标识',
    keys: ['key', 'label', 'protocol']
  },
  {
    id: 'connection',
    label: '连接与认证',
    keys: ['baseUrl', 'path', 'apiKey', 'authMode', 'authHeaderName']
  },
  {
    id: 'model',
    label: '模型',
    keys: ['model', 'deployment', 'apiVersion', 'anthropicVersion', 'region', 'instructions']
  },
  {
    id: 'sampling',
    label: '采样与输出',
    collapsible: true, // 高级采样参数，默认展开
    keys: [
      'temperature', 'maxTokens', 'maxOutputTokens', 'tokenField', 'topP', 'topK',
      'presencePenalty', 'frequencyPenalty', 'stop', 'responseFormat', 'thinkingType',
      'reasoningEffort', 'serviceTier', 'anthropicServiceTier',
      'promptCacheKey', 'promptCacheRetention', 'safetyIdentifier', 'maxToolCalls'
    ]
  },
  {
    id: 'tools',
    label: '工具调用',
    collapsible: true,
    keys: ['enableTools', 'toolChoice', 'parallelToolCalls', 'maxToolRounds', 'stripToolTraces']
  },
  {
    id: 'runtime',
    label: '运行与网络',
    collapsible: true,
    keys: ['timeout', 'enableStream', 'proxy', 'headers', 'extraBody']
  }
];

/** 按 LLM_PROVIDER_FIELD_GROUPS 过滤并排序 schema 字段，未命中分组的落入「其他」 */
export function groupProviderSchemaFields(fields = {}) {
  const fieldMap = new Map(Object.entries(fields ?? {}));
  const used = new Set();
  const sections = [];

  for (const group of LLM_PROVIDER_FIELD_GROUPS) {
    const entries = group.keys
      .filter((key) => fieldMap.has(key))
      .map((key) => [key, fieldMap.get(key)]);
    if (!entries.length) continue;
    entries.forEach(([key]) => used.add(key));
    sections.push({ ...group, entries });
  }

  const rest = [...fieldMap.entries()].filter(([key]) => !used.has(key));
  if (rest.length) {
    sections.push({ id: 'other', label: '其他', entries: rest });
  }

  return sections;
}
