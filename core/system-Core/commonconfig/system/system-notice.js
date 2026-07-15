import { getConfigPath } from './system-schema-helpers.js';
export const noticeConfig = {
      name: 'notice',
      displayName: '通知配置',
      description: '各种通知服务配置',
      filePath: getConfigPath('notice'),
      fileType: 'yaml',
      schema: {
        fields: {
          iyuu: {
            type: 'string',
            label: 'IYUU Token',
            description: 'IYUU通知服务Token',
            default: '',
            component: 'Input'
          },
          sct: {
            type: 'string',
            label: 'Server酱',
            description: 'Server酱SendKey',
            default: '',
            component: 'Input'
          },
          feishu_webhook: {
            type: 'string',
            label: '飞书机器人Webhook',
            default: '',
            component: 'Input'
          }
        }
      }
    }
