import { getConfigPath } from './system-schema-helpers.js';
export const chatbotConfig = {
      name: 'chatbot',
      displayName: 'Chatbot业务配置',
      description: 'Chatbot业务相关配置，包括主人、白名单、黑名单、自动处理、私聊、频道等',
      filePath: getConfigPath('chatbot'),
      fileType: 'yaml',
      schema: {
        fields: {
          master: {
            type: 'object',
            label: '主人配置',
            component: 'SubForm',
            fields: {
              qq: {
                type: 'array',
                label: '主人QQ号列表',
                description: '主人拥有最高权限，不受任何限制',
                itemType: 'string',
                default: [],
                component: 'Tags'
              }
            }
          },
          auto: {
            type: 'object',
            label: '自动处理配置',
            component: 'SubForm',
            fields: {
              friend: {
                type: 'number',
                label: '自动同意加好友',
                description: '1: 同意, 0: 不处理',
                enum: [0, 1],
                default: 1,
                component: 'Select'
              },
              quit: {
                type: 'number',
                label: '自动退群人数',
                description: '当被好友拉进群时，群人数小于配置值自动退出，默认50，0则不处理',
                min: 0,
                default: 50,
                component: 'InputNumber'
              }
            }
          },
          private: {
            type: 'object',
            label: '私聊配置',
            component: 'SubForm',
            fields: {
              disabled: {
                type: 'boolean',
                label: '禁用私聊功能',
                description: 'true: 私聊只接受ck以及抽卡链接（AgentRuntime主人不受限制），false: 私聊可以触发全部指令',
                default: false,
                component: 'Switch'
              },
              disabledMsg: {
                type: 'string',
                label: '禁用私聊AgentRuntime提示内容',
                default: '私聊功能已禁用',
                component: 'Input'
              },
              passKeywords: {
                type: 'array',
                label: '私聊通行字符串',
                description: '包含这些字符串的消息不受限制',
                itemType: 'string',
                default: ['stoken'],
                component: 'Tags'
              }
            }
          },
          whitelist: {
            type: 'object',
            label: '白名单配置（保留给上层模块使用，Server 不再内置 HTTP 鉴权白名单）',
            component: 'SubForm',
            fields: {
              groups: {
                type: 'array',
                label: '白名单群',
                description: '配置后只在该群生效',
                itemType: 'string',
                default: [],
                component: 'Tags'
              },
              qq: {
                type: 'array',
                label: '白名单QQ',
                itemType: 'string',
                default: [],
                component: 'Tags'
              }
            }
          },
          blacklist: {
            type: 'object',
            label: '黑名单配置',
            component: 'SubForm',
            fields: {
              groups: {
                type: 'array',
                label: '黑名单群',
                itemType: 'string',
                default: [],
                component: 'Tags'
              },
              qq: {
                type: 'array',
                label: '黑名单QQ',
                itemType: 'string',
                default: [],
                component: 'Tags'
              }
            }
          },
          guild: {
            type: 'object',
            label: '频道消息配置',
            component: 'SubForm',
            fields: {
              disableMsg: {
                type: 'boolean',
                label: '禁用频道消息',
                default: true,
                component: 'Switch'
              }
            }
          }
        }
      }
    }
