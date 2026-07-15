import { getConfigPath } from './system-schema-helpers.js';
export const groupConfig = {
      name: 'group',
      displayName: '群组配置',
      description: '群聊相关配置',
      filePath: getConfigPath('group'),
      fileType: 'yaml',
      schema: {
        meta: {
          collections: [
            {
              name: 'groupOverrides',
              type: 'keyedObject',
              label: '群单独配置',
              description: '为特定群覆盖默认配置，键为群号或标识',
              basePath: '',
              excludeKeys: ['default'],
              keyLabel: '群号',
              keyPlaceholder: '请输入群号',
              valueTemplatePath: 'default'
            }
          ]
        },
        fields: {
          default: {
            type: 'object',
            label: '默认配置',
            component: 'SubForm',
            fields: {
              groupGlobalCD: {
                type: 'number',
                label: '整体冷却时间',
                description: '群聊中所有指令操作冷却时间（毫秒）',
                min: 0,
                default: 500,
                component: 'InputNumber'
              },
              singleCD: {
                type: 'number',
                label: '个人冷却时间',
                description: '群聊中个人操作冷却时间（毫秒）',
                min: 0,
                default: 500,
                component: 'InputNumber'
              },
              onlyReplyAt: {
                type: 'number',
                label: '只关注At',
                description: '0-否 1-是 2-触发用户非主人只回复@',
                enum: [0, 1, 2],
                default: 0,
                component: 'Select'
              },
              botAlias: {
                type: 'array',
                label: '机器人别名',
                itemType: 'string',
                default: ['葵子', '葵葵'],
                component: 'Tags'
              },
              addPrivate: {
                type: 'number',
                label: '私聊添加',
                enum: [0, 1],
                default: 1,
                component: 'Select'
              },
              enable: {
                type: 'array',
                label: '功能白名单',
                itemType: 'string',
                default: [],
                component: 'Tags'
              },
              disable: {
                type: 'array',
                label: '功能黑名单',
                itemType: 'string',
                default: [],
                component: 'Tags'
              },
              bannedWords: {
                type: 'object',
                label: '违禁词配置',
                component: 'SubForm',
                fields: {
                  enabled: {
                type: 'boolean',
                    label: '启用违禁词检测',
                default: true,
                component: 'Switch'
              },
                  muteTime: {
                type: 'number',
                    label: '禁言时间',
                description: '违禁词触发禁言时间（分钟）',
                min: 0,
                default: 720,
                component: 'InputNumber'
              },
                  warnOnly: {
                type: 'boolean',
                    label: '仅警告',
                description: '是否仅警告不禁言',
                default: false,
                component: 'Switch'
              },
                  exemptRoles: {
                type: 'array',
                    label: '免检角色',
                description: '免检角色列表（如：owner, admin）',
                itemType: 'string',
                default: [],
                component: 'Tags'
                  }
                }
              },
              addLimit: {
                type: 'number',
                label: '添加限制',
                description: '添加限制：0-无限制 1-仅主人 2-管理员及以上',
                enum: [0, 1, 2],
                default: 0,
                component: 'Select'
              },
              addReply: {
                type: 'boolean',
                label: '添加时回复',
                description: '添加时是否回复',
                default: true,
                component: 'Switch'
              },
              addAt: {
                type: 'boolean',
                label: '添加时@用户',
                description: '添加时是否@用户',
                default: false,
                component: 'Switch'
              }
            }
          }
        }
      }
    }
