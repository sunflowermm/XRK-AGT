import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import path from 'path';
import paths from '#utils/paths.js';

/**
 * 系统配置管理
 * 管理所有系统级配置文件
 * 新配置结构：
 * - 全局配置（不随端口变化）：agt, device, monitor, notice, mongodb, redis, db, aistream
 *   存储位置：server_bots/ 根目录
 * - 服务器配置（随端口变化）：server, chatbot, group
 *   存储位置：server_bots/{port}/
 */
export default class SystemConfig extends ConfigBase {
  constructor() {
    super({
      name: 'system',
      displayName: '系统配置',
      description: 'XRK-AGT 系统配置管理',
      filePath: '',
      fileType: 'yaml'
    });

    // 全局配置列表（不随端口变化，存储在server_bots/根目录）
    const GLOBAL_CONFIGS = ['agt', 'device', 'monitor', 'notice', 'mongodb', 'redis', 'db', 'aistream'];
    
    // 服务器配置列表（随端口变化，存储在server_bots/{port}/）
    const SERVER_CONFIGS = ['server', 'chatbot', 'group'];

    // 辅助函数：生成配置路径
    const getConfigPath = (configName) => {
      return (cfg) => {
        if (GLOBAL_CONFIGS.includes(configName)) {
          // 全局配置存储在server_bots/根目录
          return `data/server_bots/${configName}.yaml`;
        } else if (SERVER_CONFIGS.includes(configName)) {
          // 服务器配置存储在server_bots/{port}/
          const port = cfg?.port ?? cfg?._port;
        if (!port) {
            throw new Error(`SystemConfig: 服务器配置 ${configName} 需要端口号`);
        }
        return `data/server_bots/${port}/${configName}.yaml`;
        } else {
          // 工厂配置等，默认使用服务器配置路径
          const port = cfg?.port ?? cfg?._port;
          if (!port) {
            throw new Error(`SystemConfig: 配置 ${configName} 需要端口号`);
          }
          return `data/server_bots/${port}/${configName}.yaml`;
        }
      };
    };

    // 定义所有系统配置文件
    this.configFiles = {
      agt: {
        name: 'agt',
        displayName: '全局配置',
        description: 'XRK-AGT全局配置，包括日志、浏览器、文件系统、系统行为等',
        filePath: getConfigPath('agt'),
        fileType: 'yaml',
        schema: {
          fields: {
            logging: {
              type: 'object',
              label: '日志配置',
              component: 'SubForm',
              fields: {
                level: {
              type: 'string',
              label: '日志等级',
              description: '日志输出等级。Mark时只显示执行命令，不显示聊天记录',
              enum: ['trace', 'debug', 'info', 'warn', 'fatal', 'mark', 'error', 'off'],
              default: 'info',
              component: 'Select'
            },
                align: {
              type: 'string',
              label: '日志头内容',
                  description: '日志头内容自定义显示',
              component: 'Input'
            },
                color: {
              type: 'string',
              label: '日志头颜色方案',
              description: '选择日志头的颜色主题',
              enum: ['default', 'scheme1', 'scheme2', 'scheme3', 'scheme4', 'scheme5', 'scheme6', 'scheme7'],
              default: 'default',
              component: 'Select'
            },
                idLength: {
              type: 'number',
              label: '日志ID长度',
              description: '日志ID长度（默认16个字符）',
              min: 1,
              max: 64,
              default: 20,
              component: 'InputNumber'
            },
                idFiller: {
              type: 'string',
              label: 'ID美化字符',
              description: 'ID显示时的美化字符（用于填充空白）',
              enum: ['.', '·', '─', '•', '═', '»', '→'],
              default: '.',
              component: 'Select'
            },
                object: {
              type: 'object',
              label: '日志对象检查',
              description: '日志对象检查配置',
              component: 'SubForm',
              fields: {
                depth: {
                  type: 'number',
                  label: '检查深度',
                  min: 1,
                  default: 10,
                  component: 'InputNumber'
                },
                colors: {
                  type: 'boolean',
                  label: '彩色输出',
                  default: true,
                  component: 'Switch'
                },
                showHidden: {
                  type: 'boolean',
                  label: '显示隐藏属性',
                  default: true,
                  component: 'Switch'
                },
                showProxy: {
                  type: 'boolean',
                  label: '显示代理对象',
                  default: true,
                  component: 'Switch'
                },
                getters: {
                  type: 'boolean',
                  label: '显示getters',
                  default: true,
                  component: 'Switch'
                },
                breakLength: {
                  type: 'number',
                  label: '换行长度',
                  min: 1,
                  default: 100,
                  component: 'InputNumber'
                },
                maxArrayLength: {
                  type: 'number',
                  label: '最大数组长度',
                  min: 1,
                  default: 100,
                  component: 'InputNumber'
                },
                maxStringLength: {
                  type: 'number',
                  label: '最大字符串长度',
                  min: 1,
                  default: 1000,
                  component: 'InputNumber'
                }
              }
            },
                dir: {
                  type: 'string',
                  label: '日志目录',
                  description: '日志存储目录',
                  default: 'logs',
                  component: 'Input'
            },
                maxDays: {
                  type: 'number',
                  label: '主日志保留天数',
                  description: '主日志文件保留天数',
                  min: 1,
                  default: 30,
                  component: 'InputNumber'
            },
                traceDays: {
                  type: 'number',
                  label: 'Trace日志保留天数',
                  description: 'Trace日志文件保留天数',
                  min: 1,
                  default: 1,
                  component: 'InputNumber'
            },
                send: {
                  type: 'object',
                  label: '日志发送插件配置',
                  component: 'SubForm',
                  fields: {
                    defaultLines: {
              type: 'number',
                      label: '默认发送行数',
                      min: 1,
                      default: 120,
              component: 'InputNumber'
            },
                    maxLines: {
              type: 'number',
                      label: '最大发送行数',
              min: 1,
                      default: 1000,
              component: 'InputNumber'
            },
                    maxPerForward: {
              type: 'number',
                      label: '转发最大行数',
              min: 1,
                      default: 30,
              component: 'InputNumber'
            },
                    maxLineLength: {
                      type: 'number',
                      label: '单行最大长度',
                      min: 1,
                      default: 300,
                      component: 'InputNumber'
                    }
                  }
                }
              }
            },
            browser: {
              type: 'object',
              label: '浏览器/渲染器配置',
              component: 'SubForm',
              fields: {
                chromiumPath: {
              type: 'string',
              label: 'chromium路径',
              description: 'chromium其他路径，默认无需填写',
              default: '',
              component: 'Input'
            },
                puppeteerWs: {
              type: 'string',
              label: 'puppeteer接口地址',
              description: 'puppeteer接口地址，默认无需填写',
              default: '',
              component: 'Input'
            },
                puppeteerTimeout: {
              type: 'number',
              label: 'puppeteer截图超时时间',
                  description: 'puppeteer截图超时时间（毫秒，0表示使用默认值）',
              min: 0,
              default: 0,
              component: 'InputNumber'
            },
                renderer: {
                  type: 'string',
                  label: '渲染后端',
                  description: '渲染后端选择，详细配置位于 data/server_bots/{port}/renderers/{type}/config.yaml',
                  enum: ['puppeteer', 'playwright'],
                  default: 'puppeteer',
                  component: 'Select'
                }
              }
            },
            files: {
              type: 'object',
              label: '文件系统配置',
              component: 'SubForm',
              fields: {
                watch: {
                  type: 'boolean',
                  label: '监听文件变化',
                  description: '是否监听文件变化',
                  default: true,
                  component: 'Switch'
                },
                urlTime: {
                  type: 'number',
                  label: '文件URL有效时间',
                  description: '文件URL有效时间（分钟）',
                  min: 1,
                  default: 60,
                  component: 'InputNumber'
                },
                urlTimes: {
                  type: 'number',
                  label: '文件URL访问次数',
                  description: '文件URL访问次数限制',
                  min: 1,
                  default: 5,
                  component: 'InputNumber'
                },
                messageDataPath: {
                  type: 'string',
                  label: '消息数据路径',
                  description: '消息数据存储路径',
                  default: 'data/messageJson/',
                  component: 'Input'
                },
                bannedWordsPath: {
                  type: 'string',
                  label: '违禁词路径',
                  description: '违禁词存储路径',
                  default: 'data/bannedWords/',
                  component: 'Input'
                },
                bannedImagesPath: {
                  type: 'string',
                  label: '违禁图片路径',
                  description: '违禁图片存储路径',
                  default: 'data/bannedWords/images/',
                  component: 'Input'
                },
                bannedConfigPath: {
                  type: 'string',
                  label: '违禁词配置路径',
                  description: '违禁词配置路径',
                  default: 'data/bannedWords/config/',
                  component: 'Input'
                }
              }
            },
            system: {
              type: 'object',
              label: '系统行为配置',
              component: 'SubForm',
              fields: {
                '/→#': {
                  type: 'boolean',
                  label: '斜杠转井号',
                  description: '自动把 / 换成 #',
                  default: true,
                  component: 'Switch'
                },
                ignoreSelf: {
                  type: 'boolean',
                  label: '过滤自己',
                  description: '群聊和频道中过滤自己的消息',
                  default: true,
                  component: 'Switch'
                },
                onlineMsgExp: {
                  type: 'number',
                  label: '上线推送冷却',
                  description: '上线推送通知的冷却时间（秒）',
                  min: 0,
                  default: 86400,
                  component: 'InputNumber'
                },
                cacheGroupMember: {
              type: 'boolean',
              label: '缓存群成员列表',
              description: '是否缓存群成员列表',
              default: true,
              component: 'Switch'
                }
              }
            },
            status: {
              type: 'object',
              label: '状态插件配置',
              component: 'SubForm',
              fields: {
                showNetwork: {
              type: 'boolean',
                  label: '显示网络信息',
              description: '状态插件是否显示网络信息',
              default: true,
              component: 'Switch'
            },
                showProcess: {
              type: 'boolean',
                  label: '显示进程信息',
              description: '状态插件是否显示进程信息',
              default: true,
              component: 'Switch'
            },
                showDisk: {
              type: 'boolean',
                  label: '显示磁盘信息',
              description: '状态插件是否显示磁盘信息',
              default: true,
              component: 'Switch'
                }
              }
            }
          }
        }
      },

      chatbot: {
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
                  description: 'true: 私聊只接受ck以及抽卡链接（Bot主人不受限制），false: 私聊可以触发全部指令',
                  default: false,
                  component: 'Switch'
                },
                disabledMsg: {
                  type: 'string',
                  label: '禁用私聊Bot提示内容',
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
              label: '白名单配置',
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
      },

      server: {
        name: 'server',
        displayName: '服务器配置',
        description: 'HTTP/HTTPS服务器、反向代理、SSL证书等配置',
        filePath: getConfigPath('server'),
        fileType: 'yaml',
        schema: {
          fields: {
            server: {
              type: 'object',
              label: '基础配置',
              component: 'SubForm',
              fields: {
                name: {
                  type: 'string',
                  label: '服务器名称',
                  component: 'Input'
                },
                host: {
                  type: 'string',
                  label: '监听地址',
                  description: '0.0.0.0: 监听所有网络接口，127.0.0.1: 仅监听本地',
                  default: '0.0.0.0',
                  component: 'Input'
                },
                url: {
                  type: 'string',
                  label: '外部访问URL',
                  description: '用于生成完整的访问链接，留空则自动检测',
                  default: '',
                  component: 'Input'
                }
              }
            },
            proxy: {
              type: 'object',
              label: '反向代理配置',
              component: 'SubForm',
              fields: {
                enabled: {
                  type: 'boolean',
                  label: '启用反向代理',
                  default: false,
                  component: 'Switch'
                },
                httpPort: {
                  type: 'number',
                  label: 'HTTP端口',
                  min: 1,
                  max: 65535,
                  default: 80,
                  component: 'InputNumber'
                },
                httpsPort: {
                  type: 'number',
                  label: 'HTTPS端口',
                  min: 1,
                  max: 65535,
                  default: 443,
                  component: 'InputNumber'
                },
                healthCheck: {
                  type: 'object',
                  label: '健康检查配置',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用健康检查',
                      default: false,
                      component: 'Switch'
                    },
                    interval: {
                      type: 'number',
                      label: '检查间隔',
                      description: '检查间隔（毫秒）',
                      min: 1000,
                      default: 30000,
                      component: 'InputNumber'
                    },
                    maxFailures: {
                      type: 'number',
                      label: '最大失败次数',
                      description: '超过后标记为不健康',
                      min: 1,
                      default: 3,
                      component: 'InputNumber'
                    },
                    timeout: {
                      type: 'number',
                      label: '健康检查超时',
                      description: '健康检查超时时间（毫秒）',
                      min: 1000,
                      default: 5000,
                      component: 'InputNumber'
                    },
                    cacheTime: {
                      type: 'number',
                      label: '结果缓存时间',
                      description: '健康检查结果缓存时间（毫秒），减少频繁检查',
                      min: 0,
                      default: 5000,
                      component: 'InputNumber'
                    },
                    path: {
                      type: 'string',
                      label: '健康检查路径',
                      description: '自定义健康检查路径（可选，默认/health）',
                      component: 'Input',
                      placeholder: '/health'
                    }
                  }
                },
                domains: {
                  type: 'array',
                  label: '域名配置列表',
                  description: '支持多域名配置，每个域名可以有不同的配置',
                  component: 'ArrayForm',
                  itemType: 'object',
                  fields: {
                    domain: {
                      type: 'string',
                      label: '域名',
                      required: true,
                      component: 'Input',
                      placeholder: 'xrkk.cc'
                    },
                    staticRoot: {
                      type: 'string',
                      label: '静态文件根目录',
                      component: 'Input',
                      placeholder: './www'
                    },
                    target: {
                      type: 'string',
                      label: '目标服务器',
                      description: '单个服务器URL，或数组形式配置多个服务器启用负载均衡',
                      component: 'Input',
                      placeholder: 'http://localhost:3000'
                    },
                    loadBalance: {
                      type: 'string',
                      label: '负载均衡算法',
                      description: '当target为数组时生效',
                      enum: ['round-robin', 'weighted', 'least-connections', 'ip-hash', 'consistent-hash', 'least-response-time'],
                      default: 'round-robin',
                      component: 'Select'
                    },
                    healthUrl: {
                      type: 'string',
                      label: '自定义健康检查URL',
                      description: '覆盖全局健康检查路径',
                      component: 'Input',
                      placeholder: 'http://localhost:3000/custom-health'
                    },
                    ssl: {
                      type: 'object',
                      label: 'SSL配置',
                      component: 'SubForm',
                      fields: {
                        enabled: {
                          type: 'boolean',
                          label: '启用SSL',
                          default: false,
                          component: 'Switch'
                        },
                        certificate: {
                          type: 'object',
                          label: '证书配置',
                          component: 'SubForm',
                          fields: {
                            key: {
                              type: 'string',
                              label: '私钥文件路径',
                              component: 'Input'
                            },
                            cert: {
                              type: 'string',
                              label: '证书文件路径',
                              component: 'Input'
                            },
                            ca: {
                              type: 'string',
                              label: 'CA证书链',
                              component: 'Input'
                            }
                          }
                        }
                      }
                    },
                    rewritePath: {
                      type: 'object',
                      label: '路径重写规则',
                      component: 'SubForm',
                      fields: {
                        from: {
                          type: 'string',
                          label: '源路径',
                          component: 'Input'
                        },
                        to: {
                          type: 'string',
                          label: '目标路径',
                          component: 'Input'
                        }
                      }
                    },
                    preserveHostHeader: {
                      type: 'boolean',
                      label: '保持原始Host头',
                      default: false,
                      component: 'Switch'
                    },
                    ws: {
                      type: 'boolean',
                      label: 'WebSocket支持',
                      default: true,
                      component: 'Switch'
                    },
                    timeout: {
                      type: 'number',
                      label: '超时时间',
                      description: '代理超时时间（毫秒）',
                      min: 1000,
                      default: 30000,
                      component: 'InputNumber'
                    }
                  }
                }
              }
            },
            redirects: {
              type: 'array',
              label: 'HTTP重定向配置',
              description: '支持301/302/307/308重定向，支持通配符和条件匹配',
              component: 'ArrayForm',
              itemType: 'object',
              fields: {
                from: {
                  type: 'string',
                  label: '源路径',
                  required: true,
                  component: 'Input',
                  placeholder: '/old-path'
                },
                to: {
                  type: 'string',
                  label: '目标路径',
                  required: true,
                  component: 'Input',
                  placeholder: '/new-path'
                },
                status: {
                  type: 'number',
                  label: 'HTTP状态码',
                  enum: [301, 302, 307, 308],
                  default: 301,
                  component: 'Select'
                },
                preserveQuery: {
                  type: 'boolean',
                  label: '保留查询参数',
                  default: true,
                  component: 'Switch'
                },
                condition: {
                  type: 'string',
                  label: '条件表达式',
                  description: 'JavaScript条件表达式（可选）',
                  component: 'Input',
                  placeholder: "req.headers['user-agent'].includes('Mobile')"
                }
              }
            },
            cdn: {
              type: 'object',
              label: 'CDN配置',
              component: 'SubForm',
              fields: {
                enabled: {
                  type: 'boolean',
                  label: '启用CDN',
                  default: false,
                  component: 'Switch'
                },
                domain: {
                  type: 'string',
                  label: 'CDN域名',
                  component: 'Input',
                  placeholder: 'cdn.example.com'
                },
                staticPrefix: {
                  type: 'string',
                  label: '静态资源前缀',
                  default: '/static',
                  component: 'Input'
                },
                https: {
                  type: 'boolean',
                  label: '使用HTTPS',
                  default: true,
                  component: 'Switch'
                },
                type: {
                  type: 'string',
                  label: 'CDN类型',
                  description: '用于优化CDN特定头部',
                  enum: ['general', 'cloudflare', 'aliyun', 'tencent', 'aws', 'baidu', 'qiniu', 'ucloud'],
                  default: 'general',
                  component: 'Select'
                },
                cacheControl: {
                  type: 'object',
                  label: '缓存控制',
                  component: 'SubForm',
                  fields: {
                    static: {
                      type: 'number',
                      label: '静态资源缓存（秒）',
                      description: 'CSS/JS/字体文件',
                      min: 0,
                      default: 31536000,
                      component: 'InputNumber'
                    },
                    images: {
                      type: 'number',
                      label: '图片缓存（秒）',
                      min: 0,
                      default: 604800,
                      component: 'InputNumber'
                    },
                    default: {
                      type: 'number',
                      label: '默认缓存（秒）',
                      min: 0,
                      default: 3600,
                      component: 'InputNumber'
                    }
                  }
                }
              }
            },
            https: {
              type: 'object',
              label: 'HTTPS配置',
              component: 'SubForm',
              fields: {
                enabled: {
                  type: 'boolean',
                  label: '启用HTTPS',
                  default: false,
                  component: 'Switch'
                },
                certificate: {
                  type: 'object',
                  label: '默认证书配置',
                  component: 'SubForm',
                  fields: {
                    key: {
                      type: 'string',
                      label: '私钥文件路径',
                      component: 'Input'
                    },
                    cert: {
                      type: 'string',
                      label: '证书文件路径',
                      component: 'Input'
                    },
                    ca: {
                      type: 'string',
                      label: 'CA证书链路径',
                      component: 'Input'
                    }
                  }
                },
                tls: {
                  type: 'object',
                  label: 'TLS配置',
                  component: 'SubForm',
                  fields: {
                    minVersion: {
                      type: 'string',
                      label: '最低TLS版本',
                      enum: ['TLSv1.0', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
                      default: 'TLSv1.2',
                      component: 'Select'
                    },
                    http2: {
                      type: 'boolean',
                      label: '启用HTTP/2',
                      default: true,
                      component: 'Switch'
                    }
                  }
                },
                hsts: {
                  type: 'object',
                  label: 'HSTS配置',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用HSTS',
                      default: false,
                      component: 'Switch'
                    },
                    maxAge: {
                      type: 'number',
                      label: '有效期',
                      description: '有效期（秒），31536000 = 1年',
                      min: 0,
                      default: 31536000,
                      component: 'InputNumber'
                    },
                    includeSubDomains: {
                      type: 'boolean',
                      label: '包含子域名',
                      default: true,
                      component: 'Switch'
                    },
                    preload: {
                      type: 'boolean',
                      label: '允许预加载',
                      default: false,
                      component: 'Switch'
                    }
                  }
                }
              }
            },
            static: {
              type: 'object',
              label: '静态文件服务',
              component: 'SubForm',
              fields: {
                index: {
                  type: 'array',
                  label: '默认首页文件',
                  itemType: 'string',
                  default: ['index.html', 'index.htm', 'default.html'],
                  component: 'Tags'
                },
                extensions: {
                  type: 'boolean',
                  label: '自动添加扩展名',
                  default: false,
                  component: 'Switch'
                },
                cacheTime: {
                  type: 'string',
                  label: '缓存时间',
                  description: '支持格式：1d = 1天, 1h = 1小时',
                  default: '1d',
                  component: 'Input'
                }
              }
            },
            security: {
              type: 'object',
              label: '安全配置',
              component: 'SubForm',
              fields: {
                helmet: {
                  type: 'object',
                  label: 'Helmet安全头',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用Helmet',
                      default: true,
                      component: 'Switch'
                    }
                  }
                },
                hsts: {
                  type: 'object',
                  label: 'HSTS配置',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用HSTS',
                      default: false,
                      component: 'Switch'
                    },
                    maxAge: {
                      type: 'number',
                      label: '有效期',
                      description: '有效期（秒），31536000 = 1年',
                      min: 0,
                      default: 31536000,
                      component: 'InputNumber'
                    },
                    includeSubDomains: {
                      type: 'boolean',
                      label: '包含子域名',
                      default: true,
                      component: 'Switch'
                    },
                    preload: {
                      type: 'boolean',
                      label: '允许预加载',
                      default: false,
                      component: 'Switch'
                    }
                  }
                },
                hiddenFiles: {
                  type: 'array',
                  label: '隐藏文件模式',
                  description: '匹配这些模式的文件将返回404，注意：这些模式不会影响 /api/* 路径',
                  itemType: 'string',
                  default: ['^\\..*', 'node_modules', '\\.git', '\\.env', '^/config/', '^/private/'],
                  component: 'Tags'
                }
              }
            },
            cors: {
              type: 'object',
              label: 'CORS配置',
              component: 'SubForm',
              fields: {
                enabled: {
                  type: 'boolean',
                  label: '启用CORS',
                  default: true,
                  component: 'Switch'
                },
                origins: {
                  type: 'array',
                  label: '允许的来源',
                  itemType: 'string',
                  default: ['*'],
                  component: 'Tags'
                },
                methods: {
                  type: 'array',
                  label: '允许的方法',
                  itemType: 'string',
                  default: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
                  component: 'MultiSelect'
                },
                headers: {
                  type: 'array',
                  label: '允许的请求头',
                  itemType: 'string',
                  default: ['Content-Type', 'Authorization', 'X-API-Key'],
                  component: 'Tags'
                },
                credentials: {
                  type: 'boolean',
                  label: '允许凭证',
                  default: false,
                  component: 'Switch'
                },
                maxAge: {
                  type: 'number',
                  label: '预检缓存时间',
                  description: '预检请求缓存时间（秒）',
                  min: 0,
                  default: 86400,
                  component: 'InputNumber'
                }
              }
            },
            auth: {
              type: 'object',
              label: '认证配置',
              component: 'SubForm',
              fields: {
                apiKey: {
                  type: 'object',
                  label: 'API密钥配置',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用API密钥',
                      default: true,
                      component: 'Switch'
                    },
                    file: {
                      type: 'string',
                      label: '密钥存储文件',
                      default: 'config/server_config/api_key.json',
                      component: 'Input'
                    },
                    length: {
                      type: 'number',
                      label: '密钥长度',
                      min: 16,
                      max: 128,
                      default: 64,
                      component: 'InputNumber'
                    }
                  }
                },
                whitelist: {
                  type: 'array',
                  label: '白名单路径',
                  itemType: 'string',
                  default: ['/', '/favicon.ico', '/health', '/status', '/robots.txt', '/media/*', '/uploads/*'],
                  component: 'Tags'
                }
              }
            },
            rateLimit: {
              type: 'object',
              label: '速率限制',
              component: 'SubForm',
              fields: {
                enabled: {
                  type: 'boolean',
                  label: '启用速率限制',
                  default: true,
                  component: 'Switch'
                },
                global: {
                  type: 'object',
                  label: '全局限制',
                  component: 'SubForm',
                  fields: {
                    windowMs: {
                      type: 'number',
                      label: '时间窗口',
                      description: '时间窗口（毫秒）',
                      min: 1000,
                      default: 900000,
                      component: 'InputNumber'
                    },
                    max: {
                      type: 'number',
                      label: '最大请求数',
                      min: 1,
                      default: 1000,
                      component: 'InputNumber'
                    },
                    message: {
                      type: 'string',
                      label: '提示信息',
                      default: '请求过于频繁，请稍后再试',
                      component: 'Input'
                    }
                  }
                },
                api: {
                  type: 'object',
                  label: 'API限制',
                  component: 'SubForm',
                  fields: {
                    windowMs: {
                      type: 'number',
                      label: '时间窗口',
                      min: 1000,
                      default: 60000,
                      component: 'InputNumber'
                    },
                    max: {
                      type: 'number',
                      label: '最大请求数',
                      min: 1,
                      default: 60,
                      component: 'InputNumber'
                    },
                    message: {
                      type: 'string',
                      label: '提示信息',
                      default: 'API请求过于频繁',
                      component: 'Input'
                    }
                  }
                }
              }
            },
            limits: {
              type: 'object',
              label: '请求限制',
              component: 'SubForm',
              fields: {
                urlencoded: {
                  type: 'string',
                  label: 'URL编码数据',
                  default: '10mb',
                  component: 'Input'
                },
                json: {
                  type: 'string',
                  label: 'JSON数据',
                  default: '10mb',
                  component: 'Input'
                },
                raw: {
                  type: 'string',
                  label: '原始数据',
                  default: '50mb',
                  component: 'Input'
                },
                text: {
                  type: 'string',
                  label: '文本数据',
                  default: '10mb',
                  component: 'Input'
                },
                fileSize: {
                  type: 'string',
                  label: '文件上传',
                  default: '100mb',
                  component: 'Input'
                }
              }
            },
            compression: {
              type: 'object',
              label: '压缩配置',
              component: 'SubForm',
              fields: {
                enabled: {
                  type: 'boolean',
                  label: '启用压缩',
                  default: true,
                  component: 'Switch'
                },
                level: {
                  type: 'number',
                  label: '压缩级别',
                  description: '0: 无压缩，9: 最大压缩，推荐：6',
                  min: 0,
                  max: 9,
                  default: 6,
                  component: 'InputNumber'
                },
                threshold: {
                  type: 'number',
                  label: '最小压缩大小',
                  description: '小于此大小的响应不会被压缩（字节）',
                  min: 0,
                  default: 1024,
                  component: 'InputNumber'
                }
              }
            },
            logging: {
              type: 'object',
              label: '日志配置',
              component: 'SubForm',
              fields: {
                requests: {
                  type: 'boolean',
                  label: '记录请求',
                  default: true,
                  component: 'Switch'
                },
                errors: {
                  type: 'boolean',
                  label: '记录错误',
                  default: true,
                  component: 'Switch'
                },
                debug: {
                  type: 'boolean',
                  label: '调试日志',
                  default: false,
                  component: 'Switch'
                },
                quiet: {
                  type: 'array',
                  label: '静默路径',
                  itemType: 'string',
                  default: ['/health', '/favicon.ico', '/robots.txt'],
                  component: 'Tags'
                }
              }
            },
            performance: {
              type: 'object',
              label: '性能优化配置',
              component: 'SubForm',
              fields: {
                keepAlive: {
                  type: 'object',
                  label: 'Keep-Alive配置',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用Keep-Alive',
                      default: true,
                      component: 'Switch'
                    },
                    initialDelay: {
                      type: 'number',
                      label: '初始延迟',
                      description: '初始延迟（毫秒）',
                      min: 0,
                      default: 1000,
                      component: 'InputNumber'
                    },
                    timeout: {
                      type: 'number',
                      label: '超时时间',
                      description: '超时时间（毫秒）',
                      min: 1000,
                      default: 120000,
                      component: 'InputNumber'
                    }
                  }
                },
                http2Push: {
                  type: 'object',
                  label: 'HTTP/2 Server Push',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用HTTP/2 Push',
                      description: '需要HTTP/2支持',
                      default: false,
                      component: 'Switch'
                    },
                    criticalAssets: {
                      type: 'array',
                      label: '关键资源列表',
                      description: '自动推送的关键资源',
                      itemType: 'string',
                      component: 'Tags',
                      default: []
                    }
                  }
                },
                connectionPool: {
                  type: 'object',
                  label: '连接池配置',
                  component: 'SubForm',
                  fields: {
                    maxSockets: {
                      type: 'number',
                      label: '最大Socket数',
                      description: '每个主机的最大socket数',
                      min: 1,
                      default: 50,
                      component: 'InputNumber'
                    },
                    maxFreeSockets: {
                      type: 'number',
                      label: '最大空闲Socket数',
                      min: 1,
                      default: 10,
                      component: 'InputNumber'
                    },
                    timeout: {
                      type: 'number',
                      label: 'Socket超时时间',
                      description: 'socket超时时间（毫秒）',
                      min: 1000,
                      default: 30000,
                      component: 'InputNumber'
                    }
                  }
                }
              }
            },
            misc: {
              type: 'object',
              label: '其他配置',
              component: 'SubForm',
              fields: {
                detectPublicIP: {
                  type: 'boolean',
                  label: '检测公网IP',
                  default: true,
                  component: 'Switch'
                },
                defaultRoute: {
                  type: 'string',
                  label: '404重定向',
                  default: '/',
                  component: 'Input'
                }
              }
            }
          }
        }
      },

      db: {
        name: 'db',
        displayName: '数据库配置',
        description: 'Sequelize数据库连接配置',
        filePath: getConfigPath('db'),
        fileType: 'yaml',
        schema: {
          required: ['dialect'],
          fields: {
            dialect: {
              type: 'string',
              label: '数据库类型',
              enum: ['sqlite', 'mysql', 'mariadb', 'postgres', 'mssql', 'db2'],
              default: 'sqlite',
              component: 'Select'
            },
            storage: {
              type: 'string',
              label: 'SQLite文件地址',
              default: 'data/db/data.db',
              component: 'Input'
            },
            logging: {
              type: 'boolean',
              label: '日志输出',
              default: false,
              component: 'Switch'
            }
          }
        }
      },

      device: {
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
                maxDevices: {
              type: 'number',
              label: '最大设备数量',
              min: 1,
              default: 100,
              component: 'InputNumber'
            },
                maxLogsPerDevice: {
              type: 'number',
              label: '设备最大日志条数',
              min: 1,
              default: 100,
              component: 'InputNumber'
            },
                maxDataPerDevice: {
              type: 'number',
              label: '设备最大数据条数',
              min: 1,
              default: 50,
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
            },
                batchSize: {
              type: 'number',
              label: '批量发送数量',
              min: 1,
              default: 100,
              component: 'InputNumber'
                }
              }
            },
            websocket: {
              type: 'object',
              label: 'WebSocket配置',
              component: 'SubForm',
              fields: {
                pingInterval: {
                  type: 'number',
                  label: 'Ping间隔（毫秒）',
                  default: 30000,
                  component: 'InputNumber'
                },
                pongTimeout: {
                  type: 'number',
                  label: 'Pong超时（毫秒）',
                  default: 10000,
                  component: 'InputNumber'
                },
                reconnectDelay: {
                  type: 'number',
                  label: '重连延迟（毫秒）',
                  default: 2000,
                  component: 'InputNumber'
                },
                maxReconnectAttempts: {
                  type: 'number',
                  label: '最大重连尝试次数',
                  default: 5,
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
                },
                enablePerformanceLogs: {
                  type: 'boolean',
                  label: '启用性能日志',
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
      },

      group: {
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
      },

      notice: {
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
      },

      redis: {
        name: 'redis',
        displayName: 'Redis配置',
        description: 'Redis服务器连接配置',
        filePath: getConfigPath('redis'),
        fileType: 'yaml',
        schema: {
          required: ['host', 'port', 'db'],
          fields: {
            host: {
              type: 'string',
              label: 'Redis地址',
              default: '127.0.0.1',
              component: 'Input'
            },
            port: {
              type: 'number',
              label: 'Redis端口',
              min: 1,
              max: 65535,
              default: 6379,
              component: 'InputNumber'
            },
            username: {
              type: 'string',
              label: 'Redis用户名',
              default: '',
              component: 'Input'
            },
            password: {
              type: 'string',
              label: 'Redis密码',
              default: '',
              component: 'InputPassword'
            },
            db: {
              type: 'number',
              label: 'Redis数据库',
              min: 0,
              default: 0,
              component: 'InputNumber'
            },
            options: {
              type: 'object',
              label: 'Redis连接选项',
              component: 'SubForm',
              fields: {
                connectionPoolSize: {
                  type: 'string',
                  label: '连接池大小',
                  description: 'auto: 自动计算，或指定数字（3-50）',
                  default: 'auto',
                  component: 'Input'
                },
                commandsQueueMaxLength: {
                  type: 'number',
                  label: '命令队列最大长度',
                  min: 1,
                  default: 5000,
                  component: 'InputNumber'
                },
                connectTimeout: {
                  type: 'number',
                  label: '连接超时时间（毫秒）',
                  min: 1000,
                  default: 10000,
              component: 'InputNumber'
                }
              }
            }
          }
        }
      },

      mongodb: {
        name: 'mongodb',
        displayName: 'MongoDB配置',
        description: 'MongoDB服务器连接配置',
        filePath: getConfigPath('mongodb'),
        fileType: 'yaml',
        schema: {
          required: ['host', 'port', 'database'],
          fields: {
            host: {
              type: 'string',
              label: 'MongoDB地址',
              default: '127.0.0.1',
              component: 'Input'
            },
            port: {
              type: 'number',
              label: 'MongoDB端口',
              min: 1,
              max: 65535,
              default: 27017,
              component: 'InputNumber'
            },
            username: {
              type: 'string',
              label: 'MongoDB用户名',
              default: '',
              component: 'Input'
            },
            password: {
              type: 'string',
              label: 'MongoDB密码',
              default: '',
              component: 'InputPassword'
            },
            database: {
              type: 'string',
              label: 'MongoDB数据库名称',
              component: 'Input'
            },
            options: {
              type: 'object',
              label: 'MongoDB连接选项',
              description: 'MongoDB连接选项（可选）',
              component: 'SubForm',
              fields: {
                maxPoolSize: {
                  type: 'number',
                  label: '最大连接池大小',
                  min: 1,
                  default: 50,
                  component: 'InputNumber'
                },
                minPoolSize: {
                  type: 'number',
                  label: '最小连接池大小',
                  min: 1,
                  default: 3,
                  component: 'InputNumber'
                },
                connectTimeoutMS: {
                  type: 'number',
                  label: '连接超时时间(ms)',
                  min: 1000,
                  default: 10000,
                  component: 'InputNumber'
                },
                serverSelectionTimeoutMS: {
                  type: 'number',
                  label: '服务器选择超时时间(ms)',
                  min: 1000,
                  default: 10000,
                  component: 'InputNumber'
                }
              }
            }
          }
        }
      },

      aistream: {
        name: 'aistream',
        displayName: '工作流系统配置',
        description: 'AI工作流系统配置，仅负责选择工厂运营商，详细配置位于各自的工厂配置文件中',
        filePath: getConfigPath('aistream'),
        fileType: 'yaml',
        schema: {
          fields: {
            enabled: {
              type: 'boolean',
              label: '启用工作流',
              default: true,
              component: 'Switch'
            },
            streamDir: {
              type: 'string',
              label: '工作流目录',
              default: 'core/stream',
              component: 'Input'
            },
            global: {
              type: 'object',
              label: '全局设置',
              component: 'SubForm',
              fields: {
                maxTimeout: {
                  type: 'number',
                  label: '最大执行超时（毫秒）',
                  min: 1000,
                  default: 360000,
                  component: 'InputNumber'
                },
                debug: {
                  type: 'boolean',
                  label: '调试日志',
                  default: false,
                  component: 'Switch'
                },
                maxConcurrent: {
                  type: 'number',
                  label: '并发执行限制',
                  min: 1,
                  default: 5,
                  component: 'InputNumber'
                }
              }
            },
            cache: {
              type: 'object',
              label: '缓存设置',
              component: 'SubForm',
              fields: {
                enabled: {
                  type: 'boolean',
                  label: '启用缓存',
                  default: true,
                  component: 'Switch'
                },
                ttl: {
                  type: 'number',
                  label: '缓存过期时间',
                  description: '缓存过期时间（秒）',
                  min: 1,
                  default: 300,
                  component: 'InputNumber'
                },
                maxSize: {
                  type: 'number',
                  label: '最大缓存条数',
                  min: 1,
                  default: 100,
                  component: 'InputNumber'
                }
              }
            },
            llm: {
              type: 'object',
              label: 'LLM工厂运营商选择',
              description: '详细配置位于 data/server_bots/{port}/*_llm.yaml（如 gptgod_llm / volcengine_llm / xiaomimimo_llm / openai_llm / openai_compat_llm / gemini_llm）',
              component: 'SubForm',
              fields: {
                Provider: {
                  type: 'string',
                  label: 'LLM运营商',
                  enum: ['gptgod', 'volcengine', 'xiaomimimo', 'openai', 'openai_compat', 'gemini', 'anthropic', 'azure_openai'],
                  default: 'gptgod',
                  component: 'Select'
                },
                timeout: {
                  type: 'number',
                  label: '请求超时时间（毫秒）',
                  description: '默认360000（6分钟），超时会触发"operation was aborted"错误',
                  min: 1000,
                  default: 360000,
                  component: 'InputNumber'
                },
                retry: {
                  type: 'object',
                  label: '重试配置',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用重试',
                      default: true,
                      component: 'Switch'
                    },
                    maxAttempts: {
                      type: 'number',
                      label: '最大重试次数',
                      min: 1,
                      max: 10,
                      default: 3,
                      component: 'InputNumber'
                    },
                    delay: {
                      type: 'number',
                      label: '重试延迟（毫秒）',
                      min: 100,
                      default: 2000,
                      component: 'InputNumber'
                    },
                    retryOn: {
                      type: 'array',
                      label: '重试条件',
                      description: 'timeout（超时）、network（网络错误）、5xx（服务器错误）、all（所有错误）',
                      itemType: 'string',
                      enum: ['timeout', 'network', '5xx', 'all'],
                      default: ['timeout', 'network', '5xx'],
                      component: 'MultiSelect'
                    }
                  }
                }
              }
            },
            // 识图能力已统一由各家 LLM 自身的多模态接口承担，这里不再单独暴露 Vision 工厂配置
            asr: {
              type: 'object',
              label: 'ASR工厂运营商选择',
              description: '详细配置位于 data/server_bots/{port}/volcengine_asr.yaml。ASR识别结果会调用工作流。',
              component: 'SubForm',
              fields: {
                Provider: {
                  type: 'string',
                  label: 'ASR运营商',
                  enum: ['volcengine'],
                  default: 'volcengine',
                  component: 'Select'
                },
                workflow: {
                  type: 'string',
                  label: '工作流名称',
                  description: 'ASR识别结果调用的工作流名称',
                  default: 'device',
                  component: 'Input'
                }
              }
            },
            tts: {
              type: 'object',
              label: 'TTS工厂运营商选择',
              description: '详细配置位于 data/server_bots/{port}/volcengine_tts.yaml',
              component: 'SubForm',
              fields: {
                Provider: {
                  type: 'string',
                  label: 'TTS运营商',
                  enum: ['volcengine'],
                  default: 'volcengine',
                  component: 'Select'
                },
                onlyForASR: {
                  type: 'boolean',
                  label: '仅ASR触发TTS',
                  description: '关闭后所有消息事件都能触发TTS',
                  default: true,
                  component: 'Switch'
                }
              }
            },
            mcp: {
              type: 'object',
              label: 'MCP服务配置',
              description: 'Model Context Protocol (MCP) 服务配置，用于工具调用和跨平台集成',
              component: 'SubForm',
              fields: {
                enabled: {
                  type: 'boolean',
                  label: '启用MCP服务',
                  description: '启用MCP服务，允许其他平台连接和调用工具',
                  default: true,
                  component: 'Switch'
                },
                port: {
                  type: 'number',
                  label: 'MCP服务端口',
                  description: 'MCP服务监听的端口号（可选，默认使用HTTP API端口）',
                  min: 1024,
                  max: 65535,
                  component: 'InputNumber'
                },
                autoRegister: {
                  type: 'boolean',
                  label: '自动注册工具',
                  description: '自动从工作流中收集并注册MCP工具',
                  default: true,
                  component: 'Switch'
                },
                remote: {
                  type: 'object',
                  label: '外部MCP连接（扩展）',
                  description: '用于未来桥接外部MCP服务器的工具到本系统（仅配置占位）',
                  component: 'SubForm',
                  fields: {
                    enabled: {
                      type: 'boolean',
                      label: '启用外部MCP',
                      default: false,
                      component: 'Switch'
                    },
                    servers: {
                      type: 'array',
                      label: '外部MCP服务器列表',
                      description: '每项包含 name/url，可选 headers（后续桥接实现使用）',
                      component: 'ArrayForm',
                      itemType: 'object',
                      fields: {
                        name: { type: 'string', label: '名称', component: 'Input' },
                        url: { type: 'string', label: 'URL', component: 'Input' },
                        headers: { type: 'object', label: 'Headers', component: 'SubForm', fields: {} }
                      }
                    }
                  }
                }
              }
            },
            subserver: {
              type: 'object',
              label: 'Python子服务端配置',
              description: 'Python子服务端地址配置，提供向量化、数据处理等服务',
              component: 'SubForm',
              fields: {
                host: {
                  type: 'string',
                  label: '服务地址',
                  component: 'Input',
                  default: '127.0.0.1',
                  placeholder: '127.0.0.1'
                },
                port: {
                  type: 'number',
                  label: '服务端口',
                  component: 'InputNumber',
                  default: 8000,
                  min: 1024,
                  max: 65535
                },
                timeout: {
                  type: 'number',
                  label: '请求超时（毫秒）',
                  component: 'InputNumber',
                  default: 30000,
                  min: 1000
                }
              }
            },
          }
        }
      },

      monitor: {
        name: 'monitor',
        displayName: '系统监控配置',
        description: '系统监控相关配置，包括浏览器、内存、CPU等资源监控',
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
              default: 120000,
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
                  default: true,
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
                  min: 0,
                  max: 100,
                  default: 85,
                  component: 'InputNumber'
                },
                nodeThreshold: {
                  type: 'number',
                  label: 'Node堆内存阈值（%）',
                  min: 0,
                  max: 100,
                  default: 85,
                  component: 'InputNumber'
                },
                autoOptimize: {
                  type: 'boolean',
                  label: '自动优化',
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
                  description: '激进模式（更频繁清理）',
                  default: false,
                  component: 'Switch'
                },
                autoRestart: {
                  type: 'boolean',
                  label: '自动重启',
                  description: '严重时自动重启',
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
                  label: '启用磁盘优化',
                  default: true,
                  component: 'Switch'
                },
                cleanupTemp: {
                  type: 'boolean',
                  label: '清理临时文件',
                  default: true,
                  component: 'Switch'
                },
                cleanupLogs: {
                  type: 'boolean',
                  label: '清理日志文件',
                  default: true,
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
                  default: true,
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
                  default: true,
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
                  default: true,
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
                  default: true,
                  component: 'Switch'
                },
                clearCache: {
                  type: 'boolean',
                  label: '清理系统缓存',
                  default: true,
                  component: 'Switch'
                },
                optimizeCPU: {
                  type: 'boolean',
                  label: '优化CPU调度',
                  default: true,
                  component: 'Switch'
                }
              }
            }
          }
        }
      },

      renderer: {
        name: 'renderer',
        displayName: '渲染器配置',
        description: '浏览器渲染器配置，包括Puppeteer和Playwright的详细设置。配置文件位置：data/server_bots/{port}/renderers/{type}/config.yaml',
        filePath: (cfg) => {
          // 渲染器配置使用multiFile机制处理多个子文件
          // 这里返回占位路径，实际路径由multiFile.getFilePath处理
          const port = cfg?.port ?? cfg?._port;
          if (!port) {
            throw new Error('SystemConfig: 渲染器配置需要端口号');
          }
          return `data/server_bots/${port}/renderers/{type}/config.yaml`;
        },
        fileType: 'yaml',
        // 多文件配置：一个配置包含多个子文件
        multiFile: {
          keys: ['puppeteer', 'playwright'],
          getFilePath: (key) => {
            const cfg = global.cfg;
            const port = cfg?.port ?? cfg?._port;
            if (!port) {
              throw new Error('SystemConfig: 渲染器配置需要端口号');
            }
            return path.join(paths.root, `data/server_bots/${port}/renderers/${key}/config.yaml`);
          },
          getDefaultFilePath: (key) => {
            return path.join(paths.renderers, key, 'config_default.yaml');
          }
        },
        schema: {
          fields: {
            puppeteer: {
              type: 'object',
              label: 'Puppeteer配置',
              description: 'Puppeteer渲染器配置，文件位置：data/server_bots/{port}/renderers/puppeteer/config.yaml',
              component: 'SubForm',
              fields: {
                headless: {
                  type: 'string',
                  label: '无头模式',
                  description: '"new" 为新 headless 模式，"false" 为有头模式',
                  enum: ['new', 'old', 'false'],
                  default: 'new',
                  component: 'Select'
                },
                chromiumPath: {
                  type: 'string',
                  label: 'Chromium路径',
                  description: 'Chromium可执行文件路径（可选）',
                  default: '',
                  component: 'Input'
                },
                wsEndpoint: {
                  type: 'string',
                  label: 'WebSocket端点',
                  description: '连接到远程浏览器的WebSocket端点（可选）',
                  default: '',
                  component: 'Input'
                },
                args: {
                  type: 'array',
                  label: '浏览器启动参数',
                  description: 'Chromium启动参数列表',
                  itemType: 'string',
                  default: [
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-dev-shm-usage'
                  ],
                  component: 'Tags'
                },
                puppeteerTimeout: {
                  type: 'number',
                  label: '截图超时时间',
                  description: '截图超时时间（毫秒）',
                  min: 1000,
                  default: 120000,
                  component: 'InputNumber'
                },
                restartNum: {
                  type: 'number',
                  label: '重启阈值',
                  description: '截图次数达到此值后重启浏览器',
                  min: 1,
                  default: 150,
                  component: 'InputNumber'
                },
                viewport: {
                  type: 'object',
                  label: '视口设置',
                  component: 'SubForm',
                  fields: {
                    width: {
                      type: 'number',
                      label: '宽度',
                      min: 1,
                      default: 1280,
                      component: 'InputNumber'
                    },
                    height: {
                      type: 'number',
                      label: '高度',
                      min: 1,
                      default: 720,
                      component: 'InputNumber'
                    },
                    deviceScaleFactor: {
                      type: 'number',
                      label: '设备缩放因子',
                      min: 0.1,
                      max: 5,
                      default: 1,
                      component: 'InputNumber'
                    }
                  }
                }
              }
            },
            playwright: {
              type: 'object',
              label: 'Playwright配置',
              description: 'Playwright渲染器配置，文件位置：data/server_bots/{port}/renderers/playwright/config.yaml',
              component: 'SubForm',
              fields: {
                browserType: {
                  type: 'string',
                  label: '浏览器类型',
                  description: 'Playwright支持的浏览器类型',
                  enum: ['chromium', 'firefox', 'webkit'],
                  default: 'chromium',
                  component: 'Select'
                },
                headless: {
                  type: 'boolean',
                  label: '无头模式',
                  default: true,
                  component: 'Switch'
                },
                chromiumPath: {
                  type: 'string',
                  label: 'Chromium路径',
                  description: 'Chromium可执行文件路径（可选）',
                  default: '',
                  component: 'Input'
                },
                wsEndpoint: {
                  type: 'string',
                  label: 'WebSocket端点',
                  description: '连接到远程浏览器的WebSocket端点（可选）',
                  default: '',
                  component: 'Input'
                },
                args: {
                  type: 'array',
                  label: '浏览器启动参数',
                  description: '浏览器启动参数列表',
                  itemType: 'string',
                  default: [
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-dev-shm-usage'
                  ],
                  component: 'Tags'
                },
                playwrightTimeout: {
                  type: 'number',
                  label: '截图超时时间',
                  description: '截图超时时间（毫秒）',
                  min: 1000,
                  default: 120000,
                  component: 'InputNumber'
                },
                healthCheckInterval: {
                  type: 'number',
                  label: '健康检查间隔',
                  description: '健康检查间隔（毫秒）',
                  min: 1000,
                  default: 60000,
                  component: 'InputNumber'
                },
                maxRetries: {
                  type: 'number',
                  label: '最大重试次数',
                  min: 0,
                  default: 3,
                  component: 'InputNumber'
                },
                retryDelay: {
                  type: 'number',
                  label: '重试延迟',
                  description: '重试延迟（毫秒）',
                  min: 100,
                  default: 2000,
                  component: 'InputNumber'
                },
                restartNum: {
                  type: 'number',
                  label: '重启阈值',
                  description: '截图次数达到此值后重启浏览器',
                  min: 1,
                  default: 150,
                  component: 'InputNumber'
                },
                viewport: {
                  type: 'object',
                  label: '视口设置',
                  component: 'SubForm',
                  fields: {
                    width: {
                      type: 'number',
                      label: '宽度',
                      min: 1,
                      default: 1280,
                      component: 'InputNumber'
                    },
                    height: {
                      type: 'number',
                      label: '高度',
                      min: 1,
                      default: 720,
                      component: 'InputNumber'
                    },
                    deviceScaleFactor: {
                      type: 'number',
                      label: '设备缩放因子',
                      min: 0.1,
                      max: 5,
                      default: 1,
                      component: 'InputNumber'
                    }
                  }
                },
                contextOptions: {
                  type: 'object',
                  label: '上下文选项',
                  component: 'SubForm',
                  fields: {
                    bypassCSP: {
                      type: 'boolean',
                      label: '绕过CSP',
                      default: true,
                      component: 'Switch'
                    },
                    reducedMotion: {
                      type: 'string',
                      label: '减少动画',
                      enum: ['reduce', 'no-preference'],
                      default: 'reduce',
                      component: 'Select'
                    }
                  }
                }
              }
            }
          }
        }
      }
    };
  }

  /**
   * 获取指定配置文件的实例
   * @param {string} name - 配置名称
   * @returns {ConfigBase}
   */
  getConfigInstance(name) {
    const configMeta = this.configFiles[name];
    if (!configMeta) {
      throw new Error(`未知的配置: ${name}`);
    }

    return new ConfigBase(configMeta);
  }

  /**
   * 读取指定配置文件
   * @param {string} [name] - 子配置名称（可选，如果不提供则返回配置列表）
   * @returns {Promise<Object>}
   */
  async read(name) {
    if (!name) {
      return {
        name: this.name,
        displayName: this.displayName,
        description: this.description,
        configs: this.getConfigList()
      };
    }
    
    const instance = this.getConfigInstance(name);
    return await instance.read();
  }

  /**
   * 写入指定配置文件
   * @param {string} name - 子配置名称
   * @param {Object} data - 配置数据
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>}
   */
  async write(name, data, options = {}) {
    if (!name) {
      throw new Error('SystemConfig 写入需要指定子配置名称');
    }
    const instance = this.getConfigInstance(name);
    return await instance.write(data, options);
  }

  /**
   * 获取指定配置的值
   * @param {string} name - 配置名称
   * @param {string} keyPath - 键路径
   * @returns {Promise<any>}
   */
  async get(name, keyPath) {
    const instance = this.getConfigInstance(name);
    return await instance.get(keyPath);
  }

  /**
   * 设置指定配置的值
   * @param {string} name - 配置名称
   * @param {string} keyPath - 键路径
   * @param {any} value - 新值
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>}
   */
  async set(name, keyPath, value, options = {}) {
    const instance = this.getConfigInstance(name);
    return await instance.set(keyPath, value, options);
  }

  /**
   * 获取所有配置文件的结构
   * @returns {Object}
   */
  getStructure() {
    const structure = {
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      configs: {}
    };

    for (const [name, meta] of Object.entries(this.configFiles)) {
      structure.configs[name] = {
        ...meta,
        fields: meta.schema?.fields || {}
      };
    }

    return structure;
  }

  /**
   * 获取配置列表（用于API）
   * @returns {Array}
   */
  getConfigList() {
    return Object.entries(this.configFiles).map(([name, meta]) => ({
      name,
      displayName: meta.displayName,
      description: meta.description,
      filePath: meta.filePath,
      fileType: meta.fileType
    }));
  }
}
