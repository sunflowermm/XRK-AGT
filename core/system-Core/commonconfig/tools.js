import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * 工具配置管理
 * 管理终端指令执行相关配置
 * 支持前端编辑，使用相对路径
 */
export default class ToolsConfig extends ConfigBase {
  constructor() {
    super({
      name: 'tools',
      displayName: '工具配置',
      description: '终端指令执行相关配置',
      filePath: 'config/cmd/tools.yaml',
      fileType: 'yaml',
      schema: {
        fields: {
          permission: {
            type: 'string',
            label: '权限控制',
            description: '限制谁可以在终端执行命令：master=仅主人；admin=主人+管理员；all=所有人（不推荐线上开启）',
            enum: ['master', 'admin', 'all'],
            default: 'master',
            component: 'Select'
          },
          blacklist: {
            type: 'boolean',
            label: '启用黑名单',
            description: '是否启用黑名单关键词过滤',
            default: true,
            component: 'Switch'
          },
          ban: {
            type: 'array',
            label: '禁止执行的命令',
            description: '禁止执行的命令关键词列表',
            itemType: 'string',
            default: ['rm -rf', 'sudo', 'shutdown', 'reboot'],
            component: 'Tags'
          },
          shell: {
            type: 'boolean',
            label: '使用系统Shell',
            description: '是否使用系统shell执行命令',
            default: true,
            component: 'Switch'
          },
          timeout: {
            type: 'number',
            label: '命令超时时间',
            description: '命令超时时间（毫秒）',
            min: 1000,
            default: 300000,
            component: 'InputNumber'
          },
          updateInterval: {
            type: 'number',
            label: '更新间隔',
            description: '长时间命令的更新间隔（毫秒）',
            min: 100,
            default: 3000,
            component: 'InputNumber'
          },
          maxOutputLength: {
            type: 'number',
            label: '最大输出长度',
            description: '最大输出长度（字符）',
            min: 100,
            default: 5000,
            component: 'InputNumber'
          },
          saveChunkedOutput: {
            type: 'boolean',
            label: '保存分块输出',
            description: '保存分块输出并合并',
            default: true,
            component: 'Switch'
          },
          maxHistory: {
            type: 'number',
            label: '历史记录最大条数',
            description: '历史记录最大条数',
            min: 1,
            default: 100,
            component: 'InputNumber'
          },
          maxObjectDepth: {
            type: 'number',
            label: '对象检查最大深度',
            description: '对象检查最大深度',
            min: 1,
            default: 4,
            component: 'InputNumber'
          },
          circularDetection: {
            type: 'boolean',
            label: '检测循环引用',
            description: '是否检测循环引用',
            default: true,
            component: 'Switch'
          },
          printMode: {
            type: 'string',
            label: '打印模式',
            description: '命令输出在聊天里的展示方式：full=完整结构化打印（含对象结构）；simple=只输出字符串内容，适合长日志',
            enum: ['full', 'simple'],
            default: 'full',
            component: 'Select'
          },
          jsExecutionMode: {
            type: 'string',
            label: 'JS 执行模式',
            description: 'JavaScript 代码执行的安全模式：safe=安全模式（沙箱）；unsafe=非安全模式（完整权限）',
            enum: ['safe', 'unsafe'],
            default: 'safe',
            component: 'Select'
          },
          jsTimeout: {
            type: 'number',
            label: 'JS 执行超时',
            description: 'JavaScript 代码执行超时时间（毫秒）',
            min: 1000,
            default: 10000,
            component: 'InputNumber'
          }
        }
      }
    });
  }
}

