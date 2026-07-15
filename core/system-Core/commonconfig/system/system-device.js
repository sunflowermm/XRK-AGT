import { getConfigPath } from './system-schema-helpers.js';
export const deviceConfig = {
      name: 'device',
      displayName: '设备管理配置',
      description: '设备管理的核心参数配置',
      filePath: getConfigPath('device'),
      fileType: 'yaml',
      schema: {
        fields: {
          heartbeat: {
            type: 'object',
            label: '心跳配置',
            component: 'SubForm',
            fields: {
              interval: {
            type: 'number',
            label: '心跳发送间隔',
            description: '心跳发送间隔（秒）',
            min: 1,
            default: 30,
            component: 'InputNumber'
          },
              timeout: {
            type: 'number',
            label: '心跳超时时间',
            description: '心跳超时时间（秒）',
            min: 1,
                default: 1800,
            component: 'InputNumber'
              }
            }
          },
          limits: {
            type: 'object',
            label: '容量限制配置',
            component: 'SubForm',
            fields: {
              maxLogsPerDevice: {
            type: 'number',
            label: '设备最大日志条数',
            min: 1,
            default: 100,
            component: 'InputNumber'
              }
            }
          },
          command: {
            type: 'object',
            label: '命令处理配置',
            component: 'SubForm',
            fields: {
              timeout: {
            type: 'number',
            label: '命令执行超时',
            description: '命令执行超时时间（毫秒）',
            min: 100,
            default: 5000,
            component: 'InputNumber'
              }
            }
          },
          websocket: {
            type: 'object',
            label: 'WebSocket配置',
            component: 'SubForm',
            fields: {
              pongTimeout: {
                type: 'number',
                label: 'Pong超时（毫秒）',
                default: 10000,
                component: 'InputNumber'
              }
            }
          },
          messageQueue: {
            type: 'object',
            label: '消息队列配置',
            component: 'SubForm',
            fields: {
              size: {
                type: 'number',
                label: '消息队列大小',
                default: 100,
                component: 'InputNumber'
              }
            }
          },
          logging: {
            type: 'object',
            label: '日志配置',
            component: 'SubForm',
            fields: {
              enableDetailedLogs: {
                type: 'boolean',
                label: '启用详细日志',
                default: true,
                component: 'Switch'
              }
            }
          },
          audio: {
            type: 'object',
            label: '音频配置',
            component: 'SubForm',
            fields: {
              saveDir: {
                type: 'string',
                label: '音频保存目录',
                default: './data/wav',
                component: 'Input'
              }
            }
          }
        }
      }
    }
