/**
 * AI 助手配置 — data/ai/config.yaml
 */
import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import AiWorkflowLoader from '#infrastructure/ai-workflow/loader.js';
import { mergeUniqueStrings, normalizeStringArray } from '#utils/string-array-utils.js';
import RuntimeUtil from '#utils/runtime-util.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DATA_AI_CONFIG_REL = 'data/ai/config.yaml';

const FALLBACK_MERGE_WORKFLOWS = ['memory', 'database', 'tools', 'desktop', 'web', 'browser'];

function listMergeWorkflowCandidates() {
  const names = [];
  try {
    for (const s of AiWorkflowLoader.getWorkflowsByPriority?.() || []) {
      if (!s?.name || s.name === 'chat' || s.primaryStream || s.secondaryStreams) continue;
      names.push(s.name);
    }
  } catch (e) {
    RuntimeUtil.makeLog('warn', `[AIConfig] 获取工作流列表失败: ${e.message}`, 'AIConfig');
  }
  try {
    for (const remote of AiWorkflowLoader.listRemoteMCPServers?.() || []) {
      names.push(`remote-mcp.${remote}`);
    }
  } catch (e) {
    RuntimeUtil.makeLog('warn', `[AIConfig] 获取远程 MCP 列表失败: ${e.message}`, 'AIConfig');
  }
  return names.length ? names : [...FALLBACK_MERGE_WORKFLOWS];
}

function mergeWorkflowFieldSchema(extraEnum = [], overrides = {}) {
  return {
    type: 'array',
    label: '合并工作流',
    description: '并入 chat 的副工作流 / remote-mcp；勾选即严格生效，不会再自动加料。',
    itemType: 'string',
    enum: mergeUniqueStrings(listMergeWorkflowCandidates(), extraEnum),
    default: ['memory', 'database', 'tools'],
    component: 'MultiSelect',
    group: '工作流',
    ...overrides,
  };
}

function groupOverrideFields(extraEnum = []) {
  return {
    groupId: {
      type: 'string',
      label: '群号',
      required: true,
      component: 'Input',
      placeholder: '123456789',
    },
    enabled: {
      type: 'boolean',
      label: '启用',
      description: '关闭则该群不触发 AI',
      default: true,
      component: 'Switch',
    },
    prefixes: {
      type: 'array',
      label: '触发前缀',
      description: '非空覆盖全局；空=沿用全局',
      itemType: 'string',
      default: [],
      component: 'Tags',
    },
    chance: {
      type: 'number',
      label: '随机触发概率',
      description: '填写则覆盖全局',
      min: 0,
      max: 1,
      component: 'InputNumber',
      nullable: true,
    },
    cooldown: {
      type: 'number',
      label: '随机触发冷却（秒）',
      description: '填写则覆盖全局',
      min: 0,
      component: 'InputNumber',
      nullable: true,
    },
    mergeWorkflows: mergeWorkflowFieldSchema(extraEnum, {
      label: '本群合并工作流',
      description: '整表替换全局（勾几个就几个；空=仅 chat）',
      default: [],
      group: undefined,
    }),
  };
}

export default class AIConfig extends ConfigBase {
  constructor() {
    super({
      name: 'ai_config',
      displayName: 'AI 助手配置',
      description: '触发策略、人设、白名单、群覆盖、合并工作流',
      filePath: DATA_AI_CONFIG_REL,
      defaultTemplatePath: 'core/system-Core/default/ai_config.yaml',
      fileType: 'yaml',
      schema: AIConfig.schemaDefinition(),
    });
    this.prepareValidate = (data) => this._refreshDynamicSchema(data);
    this._refreshDynamicSchema();
  }

  static schemaDefinition() {
    return {
      fields: {
        enabled: {
          type: 'boolean',
          label: '启用 AI 助手',
          default: true,
          component: 'Switch',
          group: '触发',
        },
        persona: {
          type: 'string',
          label: '人设',
          default: '你是群里一起聊天的伙伴：像真人一样接话，听得懂玩笑和气氛，该正经说清、该闲聊就短打。',
          component: 'Textarea',
          group: '人设',
        },
        prefixes: {
          type: 'array',
          label: '触发前缀',
          description: '匹配任一前缀时触发；空则仅 @ 或随机',
          itemType: 'string',
          default: [],
          component: 'Tags',
          group: '触发',
        },
        groups: {
          type: 'array',
          label: '白名单群号',
          description: '空=不限制群',
          itemType: 'string',
          default: [],
          component: 'Tags',
          group: '触发',
        },
        users: {
          type: 'array',
          label: '白名单用户',
          description: '私聊可触发的 QQ；空=不允许私聊',
          itemType: 'string',
          default: [],
          component: 'Tags',
          group: '触发',
        },
        cooldown: {
          type: 'number',
          label: '随机触发冷却（秒）',
          min: 0,
          default: 300,
          component: 'InputNumber',
          group: '触发',
        },
        chance: {
          type: 'number',
          label: '随机触发概率',
          min: 0,
          max: 1,
          default: 0.1,
          component: 'InputNumber',
          group: '触发',
        },
        mergeWorkflows: mergeWorkflowFieldSchema(),
        groupOverrides: {
          type: 'array',
          label: '群单独配置',
          description: 'mergeWorkflows 整表替换；其余字段有值才覆盖',
          itemType: 'object',
          default: [],
          component: 'ArrayForm',
          itemLabel: '群覆盖',
          group: '群覆盖',
          fields: groupOverrideFields(),
        },
      },
    };
  }

  _refreshDynamicSchema(validateSnapshot = null) {
    try {
      const fields = this.schema?.fields;
      if (!fields) return;
      const snap = validateSnapshot && typeof validateSnapshot === 'object' ? validateSnapshot : {};
      const extra = [
        ...(Array.isArray(snap.mergeWorkflows) ? snap.mergeWorkflows : []),
        ...((Array.isArray(snap.groupOverrides) ? snap.groupOverrides : [])
          .flatMap((row) => (Array.isArray(row?.mergeWorkflows) ? row.mergeWorkflows : []))),
      ];
      fields.mergeWorkflows = mergeWorkflowFieldSchema(extra);
      fields.groupOverrides = { ...fields.groupOverrides, fields: groupOverrideFields(extra) };
    } catch (e) {
      RuntimeUtil.makeLog('error', `[AIConfig] 刷新动态 schema 失败: ${e.message}`, 'AIConfig');
    }
  }

  getStructure() {
    this._refreshDynamicSchema();
    return super.getStructure();
  }

  static normalizeConfig(raw) {
    const data = raw && typeof raw === 'object' ? { ...raw } : {};
    data.prefixes = normalizeStringArray(data.prefixes);
    data.groups = normalizeStringArray(data.groups);
    data.users = normalizeStringArray(data.users);
    data.mergeWorkflows = normalizeStringArray(data.mergeWorkflows);
    data.groupOverrides = Array.isArray(data.groupOverrides)
      ? data.groupOverrides
          .filter((row) => row && typeof row === 'object' && String(row.groupId ?? '').trim())
          .map((row) => ({
            ...row,
            groupId: String(row.groupId).trim(),
            prefixes: normalizeStringArray(row.prefixes),
            mergeWorkflows: normalizeStringArray(row.mergeWorkflows),
          }))
      : [];
    return data;
  }

  async read(useCache = true) {
    try {
      return AIConfig.normalizeConfig(await super.read(useCache));
    } catch (error) {
      if (error.code !== 'ENOENT' && !error.message?.includes('不存在')) throw error;
      await fs.mkdir(path.dirname(this.getFilePath()), { recursive: true });
      const defaultData = AIConfig.normalizeConfig({});
      for (const [key, meta] of Object.entries(this.schema?.fields || {})) {
        if (meta.default !== undefined) defaultData[key] = meta.default;
      }
      await this.write(defaultData, { backup: false, validate: false });
      this._cache = defaultData;
      this._cacheTime = Date.now();
      return defaultData;
    }
  }
}
