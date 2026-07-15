import { getConfigPath } from './system-schema-helpers.js';
export const monitorConfig = {
      name: 'monitor',
      displayName: '系统监控配置',
      description: '资源监控；企业默认仅观察+本进程 GC，杀浏览器/删文件/改系统须显式开启',
      filePath: getConfigPath('monitor'),
      fileType: 'yaml',
      schema: {
        fields: {
          enabled: {
            type: 'boolean',
            label: '监控总开关',
            default: true,
            component: 'Switch'
          },
          interval: {
            type: 'number',
            label: '监控检查间隔',
            description: '监控检查间隔（毫秒）',
            min: 1000,
            default: 300000,
            component: 'InputNumber'
          },
          browser: {
            type: 'object',
            label: '浏览器进程监控',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用浏览器监控',
                description: '会扫描并可能结束浏览器进程，企业默认关闭',
                default: false,
                component: 'Switch'
              },
              maxInstances: {
                type: 'number',
                label: '最大浏览器实例数',
                min: 1,
                default: 5,
                component: 'InputNumber'
              },
              memoryThreshold: {
                type: 'number',
                label: '内存阈值（%）',
                description: '内存阈值（%）触发清理',
                min: 0,
                max: 100,
                default: 90,
                component: 'InputNumber'
              },
              reserveNewest: {
                type: 'boolean',
                label: '保留最新实例',
                default: true,
                component: 'Switch'
              }
            }
          },
          memory: {
            type: 'object',
            label: '系统内存监控',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用内存监控',
                default: true,
                component: 'Switch'
              },
              systemThreshold: {
                type: 'number',
                label: '系统内存阈值（%）',
                description: '仅告警，不驱动 flushdns/GC',
                min: 0,
                max: 100,
                default: 90,
                component: 'InputNumber'
              },
              nodeThreshold: {
                type: 'number',
                label: 'Node堆内存阈值（%）',
                description: '仅堆超阈值才执行本进程 GC',
                min: 0,
                max: 100,
                default: 85,
                component: 'InputNumber'
              },
              autoOptimize: {
                type: 'boolean',
                label: '自动优化',
                description: '仅本进程 GC，不改系统',
                default: true,
                component: 'Switch'
              },
              gcInterval: {
                type: 'number',
                label: 'GC最小间隔（毫秒）',
                min: 1000,
                default: 600000,
                component: 'InputNumber'
              },
              leakDetection: {
                type: 'object',
                label: '内存泄漏检测',
                component: 'SubForm',
                fields: {
                  enabled: {
                    type: 'boolean',
                    label: '启用泄漏检测',
                    default: true,
                    component: 'Switch'
                  },
                  threshold: {
                    type: 'number',
                    label: '泄漏阈值',
                    description: '10%增长视为潜在泄漏',
                    min: 0,
                    max: 1,
                    default: 0.1,
                    component: 'InputNumber'
                  },
                  checkInterval: {
                    type: 'number',
                    label: '检查间隔（毫秒）',
                    min: 1000,
                    default: 300000,
                    component: 'InputNumber'
                  }
                }
              }
            }
          },
          cpu: {
            type: 'object',
            label: 'CPU监控',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用CPU监控',
                default: true,
                component: 'Switch'
              },
              threshold: {
                type: 'number',
                label: 'CPU使用率阈值（%）',
                min: 0,
                max: 100,
                default: 90,
                component: 'InputNumber'
              },
              checkDuration: {
                type: 'number',
                label: 'CPU检查持续时间（毫秒）',
                min: 1000,
                default: 30000,
                component: 'InputNumber'
              }
            }
          },
          optimize: {
            type: 'object',
            label: '优化策略',
            component: 'SubForm',
            fields: {
              aggressive: {
                type: 'boolean',
                label: '激进模式',
                description: '更频繁清理；Windows 下才允许 flushdns',
                default: false,
                component: 'Switch'
              },
              autoRestart: {
                type: 'boolean',
                label: '自动重启',
                description: '严重时自动重启（企业默认禁止）',
                default: false,
                component: 'Switch'
              },
              restartThreshold: {
                type: 'number',
                label: '重启阈值（%）',
                min: 0,
                max: 100,
                default: 95,
                component: 'InputNumber'
              }
            }
          },
          report: {
            type: 'object',
            label: '报告配置',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用报告',
                default: true,
                component: 'Switch'
              },
              interval: {
                type: 'number',
                label: '报告间隔（毫秒）',
                min: 1000,
                default: 3600000,
                component: 'InputNumber'
              }
            }
          },
          disk: {
            type: 'object',
            label: '磁盘优化',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用磁盘监控',
                description: '空间告警；自动删除须另开下方开关',
                default: true,
                component: 'Switch'
              },
              cleanupTemp: {
                type: 'boolean',
                label: '清理临时文件',
                description: '仅 data/temp；永不清理 uploads',
                default: false,
                component: 'Switch'
              },
              cleanupLogs: {
                type: 'boolean',
                label: '清理日志文件',
                description: '删除 logs/*.log（审计场景请保持关闭）',
                default: false,
                component: 'Switch'
              },
              tempMaxAge: {
                type: 'number',
                label: '临时文件最大年龄（毫秒）',
                default: 86400000,
                component: 'InputNumber'
              },
              logMaxAge: {
                type: 'number',
                label: '日志文件最大年龄（毫秒）',
                default: 604800000,
                component: 'InputNumber'
              },
              maxLogSize: {
                type: 'number',
                label: '单个日志文件最大大小（字节）',
                default: 104857600,
                component: 'InputNumber'
              }
            }
          },
          network: {
            type: 'object',
            label: '网络优化',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用网络优化',
                description: 'netstat 类探测，企业默认关闭',
                default: false,
                component: 'Switch'
              },
              maxConnections: {
                type: 'number',
                label: '最大连接数阈值',
                min: 1,
                default: 1000,
                component: 'InputNumber'
              },
              cleanupIdle: {
                type: 'boolean',
                label: '清理空闲连接',
                default: false,
                component: 'Switch'
              }
            }
          },
          process: {
            type: 'object',
            label: '进程优化',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用进程优化',
                description: '会修改本进程优先级，企业默认关闭',
                default: false,
                component: 'Switch'
              },
              priority: {
                type: 'string',
                label: '进程优先级',
                enum: ['low', 'normal', 'high'],
                default: 'normal',
                component: 'Select'
              },
              nice: {
                type: 'number',
                label: 'Linux nice值',
                description: 'Linux nice值 (-20到19)',
                min: -20,
                max: 19,
                default: 0,
                component: 'InputNumber'
              }
            }
          },
          system: {
            type: 'object',
            label: '系统级优化',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用系统优化',
                description: '系统级动作总开关，企业默认关闭',
                default: false,
                component: 'Switch'
              },
              clearCache: {
                type: 'boolean',
                label: '清理系统缓存',
                description: '如 flushdns；须配合激进模式',
                default: false,
                component: 'Switch'
              },
              optimizeCPU: {
                type: 'boolean',
                label: '优化CPU调度',
                description: 'Linux chrt 等，企业默认关闭',
                default: false,
                component: 'Switch'
              }
            }
          }
        }
      }
    }
