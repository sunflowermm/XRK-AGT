import ConfigBase from '../../lib/commonconfig/commonconfig.js';

/**
 * 系统配置管理
 * 管理所有系统级配置文件
 */
export default class SystemConfig extends ConfigBase {
  constructor() {
    super({
      name: 'system',
      displayName: '系统配置',
      description: 'XRK-Yunzai 系统配置管理',
      filePath: '', // 系统配置管理多个文件，此处留空
      fileType: 'yaml'
    });

    // 定义所有系统配置文件
    this.configFiles = {
      bot: {
        name: 'bot',
        displayName: '机器人配置',
        description: '机器人核心配置，包括日志、文件监听、Puppeteer等',
        filePath: 'config/config/bot.yaml',
        fileType: 'yaml',
        schema: {
          required: ['log_level'],
          fields: {
            log_level: {
              type: 'string',
              label: '日志等级',
              description: '日志输出等级。Mark时只显示执行命令，不显示聊天记录',
              enum: ['trace', 'debug', 'info', 'warn', 'fatal', 'mark', 'error', 'off'],
              default: 'info',
              component: 'Select'
            },
            log_align: {
              type: 'string',
              label: '日志头内容',
              description: '日志头内容自定义显示，例如设置为"XRKYZ"将显示[XRKYZ]',
              default: 'XRKYZ',
              component: 'Input'
            },
            log_color: {
              type: 'string',
              label: '日志头颜色方案',
              description: '选择日志头的颜色主题',
              enum: ['default', 'scheme1', 'scheme2', 'scheme3', 'scheme4', 'scheme5', 'scheme6', 'scheme7'],
              default: 'default',
              component: 'Select'
            },
            log_id_length: {
              type: 'number',
              label: '日志ID长度',
              description: '日志ID长度（默认16个字符）',
              min: 1,
              max: 64,
              default: 20,
              component: 'InputNumber'
            },
            log_id_filler: {
              type: 'string',
              label: 'ID美化字符',
              description: 'ID显示时的美化字符（用于填充空白）',
              enum: ['.', '·', '─', '•', '═', '»', '→'],
              default: '.',
              component: 'Select'
            },
            log_object: {
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
            ignore_self: {
              type: 'boolean',
              label: '过滤自己',
              description: '群聊和频道中过滤自己的消息',
              default: true,
              component: 'Switch'
            },
            '/→#': {
              type: 'boolean',
              label: '斜杠转井号',
              description: '自动把 / 换成 #',
              default: true,
              component: 'Switch'
            },
            file_watch: {
              type: 'boolean',
              label: '监听文件变化',
              description: '是否监听文件变化',
              default: true,
              component: 'Switch'
            },
            online_msg_exp: {
              type: 'number',
              label: '上线推送冷却',
              description: '上线推送通知的冷却时间（秒）',
              min: 0,
              default: 86400,
              component: 'InputNumber'
            },
            file_to_url_time: {
              type: 'number',
              label: '文件URL有效时间',
              description: '文件URL有效时间（分钟）',
              min: 1,
              default: 60,
              component: 'InputNumber'
            },
            file_to_url_times: {
              type: 'number',
              label: '文件URL访问次数',
              description: '文件URL访问次数限制',
              min: 1,
              default: 5,
              component: 'InputNumber'
            },
            chromium_path: {
              type: 'string',
              label: 'chromium路径',
              description: 'chromium其他路径，默认无需填写',
              default: '',
              component: 'Input'
            },
            puppeteer_ws: {
              type: 'string',
              label: 'puppeteer接口地址',
              description: 'puppeteer接口地址，默认无需填写',
              default: '',
              component: 'Input'
            },
            puppeteer_timeout: {
              type: 'number',
              label: 'puppeteer截图超时时间',
              description: 'puppeteer截图超时时间（毫秒）',
              min: 0,
              default: 0,
              component: 'InputNumber'
            },
            cache_group_member: {
              type: 'boolean',
              label: '缓存群成员列表',
              description: '是否缓存群成员列表',
              default: true,
              component: 'Switch'
            }
          }
        }
      },

      server: {
        name: 'server',
        displayName: '服务器配置',
        description: 'HTTP/HTTPS服务器、反向代理、SSL证书等配置',
        filePath: 'config/config/server.yaml',
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
                  default: 'XRK Server',
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
                  default: 'http://127.0.0.1',
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
                      component: 'Input',
                      placeholder: 'http://localhost:3000'
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
                hiddenFiles: {
                  type: 'array',
                  label: '隐藏文件模式',
                  itemType: 'string',
                  default: ['^\\..*', 'node_modules', '\\.git', '\\.env', 'config/', 'private/'],
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
                  default: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
                  default: ['/', '/favicon.ico', '/health', '/status', '/robots.txt', '/xrk', '/media/*', '/uploads/*'],
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
        filePath: 'config/config/db.yaml',
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
        filePath: 'config/config/device.yaml',
        fileType: 'yaml',
        schema: {
          fields: {
            heartbeat_interval: {
              type: 'number',
              label: '心跳发送间隔',
              description: '心跳发送间隔（秒）',
              min: 1,
              default: 30,
              component: 'InputNumber'
            },
            heartbeat_timeout: {
              type: 'number',
              label: '心跳超时时间',
              description: '心跳超时时间（秒）',
              min: 1,
              default: 120,
              component: 'InputNumber'
            },
            max_devices: {
              type: 'number',
              label: '最大设备数量',
              min: 1,
              default: 100,
              component: 'InputNumber'
            },
            max_logs_per_device: {
              type: 'number',
              label: '设备最大日志条数',
              min: 1,
              default: 100,
              component: 'InputNumber'
            },
            max_data_per_device: {
              type: 'number',
              label: '设备最大数据条数',
              min: 1,
              default: 50,
              component: 'InputNumber'
            },
            command_timeout: {
              type: 'number',
              label: '命令执行超时',
              description: '命令执行超时时间（毫秒）',
              min: 100,
              default: 5000,
              component: 'InputNumber'
            },
            batch_size: {
              type: 'number',
              label: '批量发送数量',
              min: 1,
              default: 100,
              component: 'InputNumber'
            }
          }
        }
      },

      group: {
        name: 'group',
        displayName: '群组配置',
        description: '群聊相关配置',
        filePath: 'config/config/group.yaml',
        fileType: 'yaml',
        schema: {
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
                  default: ['葵崽', '葵葵'],
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
        filePath: 'config/config/notice.yaml',
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

      other: {
        name: 'other',
        displayName: '其他配置',
        description: '其他杂项配置',
        filePath: 'config/config/other.yaml',
        fileType: 'yaml',
        schema: {
          fields: {
            masterQQ: {
              type: 'array',
              label: '主人QQ',
              itemType: 'string',
              default: [],
              component: 'Tags'
            },
            disableGuildMsg: {
              type: 'boolean',
              label: '禁用频道消息',
              default: true,
              component: 'Switch'
            },
            blackQQ: {
              type: 'array',
              label: '黑名单QQ',
              itemType: 'string',
              default: [],
              component: 'Tags'
            },
            whiteQQ: {
              type: 'array',
              label: '白名单QQ',
              itemType: 'string',
              default: [],
              component: 'Tags'
            },
            blackGroup: {
              type: 'array',
              label: '黑名单群',
              itemType: 'string',
              default: [],
              component: 'Tags'
            },
            whiteGroup: {
              type: 'array',
              label: '白名单群',
              itemType: 'string',
              default: [],
              component: 'Tags'
            },
            autoFriend: {
              type: 'number',
              label: '添加好友',
              enum: [0, 1],
              default: 1,
              component: 'Select'
            },
            autoQuit: {
              type: 'number',
              label: '退群人数',
              min: 0,
              default: 50,
              component: 'InputNumber'
            },
            disablePrivate: {
              type: 'boolean',
              label: '禁用私聊',
              default: false,
              component: 'Switch'
            },
            disableMsg: {
              type: 'string',
              label: '禁私聊提示',
              default: '私聊功能已禁用',
              component: 'Input'
            },
            disableAdopt: {
              type: 'array',
              label: '私聊通行字符串',
              itemType: 'string',
              default: ['stoken'],
              component: 'Tags'
            }
          }
        }
      },

      redis: {
        name: 'redis',
        displayName: 'Redis配置',
        description: 'Redis服务器连接配置',
        filePath: 'config/config/redis.yaml',
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
            }
          }
        }
      },

      renderer: {
        name: 'renderer',
        displayName: '渲染器配置',
        description: '渲染后端配置',
        filePath: 'config/config/renderer.yaml',
        fileType: 'yaml',
        schema: {
          fields: {
            name: {
              type: 'string',
              label: '渲染后端',
              enum: ['puppeteer'],
              default: 'puppeteer',
              component: 'Select'
            }
          }
        }
      },

      aistream: {
        name: 'aistream',
        displayName: '工作流系统配置',
        description: 'AI工作流系统配置',
        filePath: 'config/config/aistream.yaml',
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
              default: 'plugins/stream',
              component: 'Input'
            },
            global: {
              type: 'object',
              label: '全局设置',
              component: 'SubForm',
              fields: {
                maxTimeout: {
                  type: 'number',
                  label: '最大执行超时',
                  description: '最大执行超时时间（毫秒）',
                  min: 1000,
                  default: 30000,
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
   * @param {string} name - 配置名称
   * @returns {Promise<Object>}
   */
  async read(name) {
    const instance = this.getConfigInstance(name);
    return await instance.read();
  }

  /**
   * 写入指定配置文件
   * @param {string} name - 配置名称
   * @param {Object} data - 配置数据
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>}
   */
  async write(name, data, options = {}) {
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