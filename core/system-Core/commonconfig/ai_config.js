/**
 * AI 助手配置 — data/ai/config.yaml
 */
import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DATA_AI_CONFIG_REL = 'data/ai/config.yaml';

export default class AIConfig extends ConfigBase {
  constructor() {
    super({
      name: 'ai_config',
      displayName: 'AI 助手配置',
      description: '触发策略、人设、白名单、合并工作流（memory/tools/database/desktop 等）',
      filePath: DATA_AI_CONFIG_REL,
      defaultTemplatePath: 'core/system-Core/default/ai_config.yaml',
      fileType: 'yaml',
      schema: AIConfig.schemaDefinition(),
    });
  }

  static schemaDefinition() {
    return {
      fields: {
        enabled: {
          type: 'boolean',
          label: '启用 AI 助手',
          default: true,
          component: 'Switch',
        },
        persona: {
          type: 'string',
          label: '人设',
          description: '传入 chat 工作流的角色描述',
          default: '你是群里一起聊天的伙伴：像真人一样接话，听得懂玩笑和气氛，该正经说清、该闲聊就短打。',
          component: 'Textarea',
        },
        prefix: {
          type: 'string',
          label: '触发前缀',
          description: '白名单内消息以此开头时触发（留空则仅 @ 或随机）',
          default: '',
          component: 'Input',
        },
        groups: {
          type: 'array',
          label: '白名单群号',
          itemType: 'string',
          default: [],
          component: 'Tags',
        },
        users: {
          type: 'array',
          label: '白名单用户',
          description: '私聊可触发的 QQ',
          itemType: 'string',
          default: [],
          component: 'Tags',
        },
        cooldown: {
          type: 'number',
          label: '随机触发冷却（秒）',
          min: 0,
          default: 300,
          component: 'InputNumber',
        },
        chance: {
          type: 'number',
          label: '随机触发概率',
          description: '0～1',
          min: 0,
          max: 1,
          default: 0.1,
          component: 'InputNumber',
        },
        mergeWorkflows: {
          type: 'array',
          label: '合并工作流',
          description:
            '合并到 chat 的副工作流。可选：memory（记忆）、database（知识库）、tools（工作区读写/run）。web、browser、remote-mcp.* 由框架自动并入；chat 自带 poke/reply/发文件等 QQ 工具。',
          itemType: 'string',
          default: ['memory', 'database', 'tools'],
          component: 'Tags',
        },
      },
    };
  }

  async read(useCache = true) {
    try {
      return await super.read(useCache);
    } catch (error) {
      if (error.code !== 'ENOENT' && !error.message?.includes('不存在')) throw error;
      const filePath = this.getFilePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const defaultData = {};
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
