import { getConfigPath, crawlProviderApiFields, subserverRuntimeSubFormFields } from './system-schema-helpers.js';
export const aiWorkflowConfig = {
      name: 'ai-workflow',
      displayName: '工作流系统配置',
      description: 'AI工作流系统配置，仅负责选择工厂运营商，详细配置位于各自的工厂配置文件中',
      filePath: getConfigPath('ai-workflow'),
      fileType: 'yaml',
      schema: {
        fields: {
          enabled: {
            type: 'boolean',
            label: '启用工作流',
            description: '关闭后将禁用所有基于 AiWorkflow 的工作流（包括 Web 控制台和聊天里的 AI 功能）',
            default: true,
            component: 'Switch'
          },
          global: {
            type: 'object',
            label: '全局设置',
            component: 'SubForm',
            fields: {
              debug: {
                type: 'boolean',
                label: '调试日志',
                description: '启用后会输出更详细的工作流调试日志，仅建议在开发/排错时打开',
                default: false,
                component: 'Switch'
              }
            }
          },
          llm: {
          type: 'object',
          label: 'LLM工厂运营商选择',
          description: '在各工厂 YAML（data/server_bots/{port}/*_llm.yaml）的 providers[] 中配置端点 key，此处 Provider 填写其中任一 key',
          component: 'SubForm',
          fields: {
          Provider: {
              type: 'string',
              label: 'LLM运营商',
              description: '填写任一工厂 providers[] 条目的 key（同一 baseUrl 可配置多个不同 model 的条目）',
              default: '',
              component: 'Input'
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
              },
              promptCache: {
                type: 'object',
                label: 'Provider 提示缓存',
                description: 'OpenAI prompt_cache_key / Anthropic cache_control；静态 system+tools 前缀命中率越高，input 费用越低',
                component: 'SubForm',
                fields: {
                  enabled: {
                    type: 'boolean',
                    label: '启用自动提示缓存',
                    default: true,
                    component: 'Switch'
                  },
                  keyPrefix: {
                    type: 'string',
                    label: 'cache key 前缀',
                    default: 'xrk',
                    component: 'Input'
                  },
                  retention: {
                    type: 'string',
                    label: 'OpenAI 保留策略',
                    enum: ['in-memory', '24h'],
                    default: 'in-memory',
                    component: 'Select'
                  },
                  anthropicCache: {
                    type: 'boolean',
                    label: 'Anthropic system cache_control',
                    default: true,
                    component: 'Switch'
                  },
                  scopeInKey: {
                    type: 'boolean',
                    label: 'cache key 含会话 ID',
                    description: 'true=按群/用户隔离；false=同 bot+模型共享前缀缓存（更省、隐私弱）',
                    default: true,
                    component: 'Switch'
                  }
                }
              }
            }
          },
          // 识图能力已统一由各家 LLM 自身的多模态接口承担，这里不再单独暴露 Vision 工厂配置
          asr: {
            type: 'object',
            label: 'ASR工厂运营商选择',
            description: '详细配置位于 data/server_bots/{port}/volcengine_asr.yaml。ASR识别结果直接返回文本。',
            component: 'SubForm',
            fields: {
              Provider: {
                type: 'string',
                label: 'ASR运营商',
                enum: ['volcengine'],
                default: 'volcengine',
                component: 'Select'
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
              defaultWorkflows: {
                type: 'array',
                label: '默认启用的工作流',
                description: '留空=代码内置默认（tools、web）；填写则覆盖 ai-workflow-config 内置默认',
                itemType: 'string',
                default: [],
                component: 'MultiSelect'
              },
              defaultRemoteMcp: {
                type: 'array',
                label: '默认启用的远程 MCP',
                description: '留空=代码内置默认（tools + web）；填写则覆盖。用户自增 MCP 在 remote.mcpServers',
                itemType: 'string',
                default: [],
                component: 'MultiSelect'
              },
              toolMergeStrategy: {
                type: 'string',
                label: '工具合并策略',
                description: '当接口请求体同时传入 tools 且启用了工作流/MCP 工具时的合并策略：preferRequest=以接口 tools 为准，preferStream=以工作流/MCP 工具为准，merge=尽量合并（同名以接口为准）',
                enum: ['preferRequest', 'preferStream', 'merge'],
                default: 'preferRequest',
                component: 'Select'
              },
              remote: {
                type: 'object',
                label: '远程MCP连接',
                description: '远程 MCP 注册（建议：每条新增一个 JSON 块，直接粘贴社区的 { "mcpServers": { ... } } 即可）。',
                component: 'SubForm',
                fields: {
                  enabled: {
                    type: 'boolean',
                    label: '启用远程MCP',
                    description: '用户自增远程 MCP；开放域检索内置 web.web_search（parallel-free 零配置）',
                    default: false,
                    component: 'Switch'
                  },
                  mcpServers: {
                    type: 'array',
                    label: 'MCP Servers（JSON 列表）',
                    description: '每条为一个 JSON 对象（可直接粘贴含 mcpServers 的完整片段）。系统会把所有条目合并为最终可用的远程 MCP 列表。',
                    component: 'ArrayForm',
                    itemType: 'object',
                    itemLabel: 'JSON 块',
                    default: [],
                    fields: {
                      config: {
                        type: 'object',
                        label: 'JSON',
                        description: '示例：{ "mcpServers": { "my-mcp": { "command": "npx", "args": ["-y","some-mcp-package"] } } }',
                        component: 'json',
                        default: {}
                      }
                    }
                  }
                }
              }
            }
          },
          workspace: {
            type: 'object',
            label: 'Agent 文件工作区',
            description:
              'tools / desktop 工作流的文件操作根目录预设；控制台工作区列表来自 data/ai-workspace/*',
            component: 'SubForm',
            fields: {
              defaultId: {
                type: 'string',
                label: '默认工作区 ID',
                description: '留空或 default → data/ai-workspace/default；也可填已存在的子目录名',
                default: 'default',
                component: 'Input',
                layout: 'half'
              },
              audit: {
                type: 'object',
                label: '工具审计',
                component: 'SubForm',
                fields: {
                  enabled: {
                    type: 'boolean',
                    label: '启用 MCP 工具审计',
                    default: true,
                    component: 'Switch'
                  },
                  maxEntries: {
                    type: 'number',
                    label: '每工作区最大审计条数',
                    min: 10,
                    max: 500,
                    default: 200,
                    component: 'InputNumber'
                  }
                }
              }
            }
          },
          agentWorkspace: {
            type: 'object',
            label: 'Agent 工作区上下文（Prompt 注入）',
            description:
              '从 data/ai-workspace 注入 AGENTS/SOUL/USER/memory 等；从项目根注入 rules、skills、subagents。与 tools.file.workspace 默认同一工作区',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用注入',
                description: '关闭后不再附加工作区 Markdown 上下文',
                default: true,
                component: 'Switch'
              },
              root: {
                type: 'string',
                label: 'Prompt 注入根目录',
                description: '留空=项目根；相对项目根路径。控制台请求 workspace 会覆盖此根用于 AGENTS/rules 注入',
                default: '',
                component: 'Input',
                layout: 'full'
              },
              workflows: {
                type: 'array',
                label: '仅对这些工作流/入口注入',
                description:
                  '留空=全部生效。填工作流 name（chat、web、desktop、tools…）；填 v3 表示仅对 POST /api/v3/chat/completions 合并 system',
                itemType: 'string',
                default: [],
                component: 'MultiSelect'
              },
              includeRules: {
                type: 'boolean',
                label: '包含 rules',
                default: true,
                component: 'Switch'
              },
              includeAgentMd: {
                type: 'boolean',
                label: '注入工作区上下文（OpenClaw 模板等）',
                description: '注入 AGENT/AGENTS，以及 SOUL/USER/IDENTITY/TOOLS/HEARTBEAT/BOOTSTRAP/MEMORY 等助手向模板（存在则读取）',
                default: true,
                component: 'Switch'
              },
              includeSubagents: {
                type: 'boolean',
                label: '包含 subagents 清单',
                description: '项目根 agents/subagents.yaml|json',
                default: true,
                component: 'Switch'
              },
              includeDiagnostics: {
                type: 'boolean',
                label: '包含诊断提示',
                description: '启用后在缺失 MEMORY 等关键文件时追加简短诊断段（默认关闭）',
                default: false,
                component: 'Switch'
              },
              maxTotalChars: {
                type: 'number',
                label: 'Prose 段总字符上限',
                description:
                  '0 表示不限制（推荐）；仅约束 AGENT/bootstrap/rules/扩展文件等 prose，Skills XML 由 maxSkillsPromptChars 单独限制',
                min: 0,
                default: 0,
                component: 'InputNumber'
              },
              maxDiagnosticsChars: {
                type: 'number',
                label: '诊断提示最大字符',
                description: 'Workspace diagnostics 段的字符预算上限',
                min: 100,
                default: 2000,
                component: 'InputNumber'
              },
              contextFiles: {
                type: 'array',
                label: '额外上下文文件',
                description: '相对工作区根的路径列表（如 docs/NOTE.md），安全读入后追加到 prose',
                itemType: 'string',
                default: [],
                component: 'ArrayForm'
              },
              maxCandidatesPerRoot: {
                type: 'number',
                label: '技能根目录扫描上限（嵌套 skills 探测条目数）',
                description: '对齐 OpenClaw skills.limits.maxCandidatesPerRoot',
                min: 1,
                default: 300,
                component: 'InputNumber'
              },
              maxSkillsLoadedPerSource: {
                type: 'number',
                label: '每目录最多加载技能数',
                description: '对齐 OpenClaw skills.limits.maxSkillsLoadedPerSource',
                min: 1,
                default: 200,
                component: 'InputNumber'
              },
              maxSkillsInPrompt: {
                type: 'number',
                label: '写入 prompt 的技能条数上限',
                description: '对齐 OpenClaw skills.limits.maxSkillsInPrompt',
                min: 1,
                default: 150,
                component: 'InputNumber'
              },
              maxSkillsPromptChars: {
                type: 'number',
                label: '技能 XML  catalog 最大字符',
                description: '对齐 OpenClaw skills.limits.maxSkillsPromptChars；超出则 compact 或截断',
                min: 500,
                default: 30000,
                component: 'InputNumber'
              },
              maxSkillFileBytes: {
                type: 'number',
                label: '单个 SKILL.md 最大字节',
                description: '对齐 OpenClaw skills.limits.maxSkillFileBytes',
                min: 1024,
                default: 256000,
                component: 'InputNumber'
              },
              customSkillRoots: {
                type: 'array',
                label: '自定义技能目录',
                description:
                  '可填相对工作区路径或绝对路径；为空不注入 skills（示例：`.cursor/skills` 或 `C:/.../skills/standard`）',
                itemType: 'string',
                default: [],
                component: 'ArrayForm'
              },
              maxRulesChars: {
                type: 'number',
                label: '规则块最大字符',
                min: 100,
                default: 12000,
                component: 'InputNumber'
              },
              maxAgentMdChars: {
                type: 'number',
                label: 'AGENT 文件最大字符',
                min: 100,
                default: 12000,
                component: 'InputNumber'
              }
            }
          },
          embedding: {
            type: 'object',
            label: 'RAG / 记忆增强',
            description: '全局合并到各 AiWorkflow.embeddingConfig；开启后 MemoryManager 短期召回 + memory 工作流长期记忆 + 知识库 RAG',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用上下文增强',
                description: '关闭则跳过 storeMessageMemory 与 retrieveKnowledgeContexts（各工作流仍可单独 enabled: false）',
                default: true,
                component: 'Switch'
              },
              maxContexts: {
                type: 'number',
                label: '单次检索最大上下文条数',
                description: 'AiWorkflow 合并多工作流 retrieveKnowledgeContexts 时的上限',
                min: 1,
                max: 50,
                default: 5,
                component: 'InputNumber'
              }
            }
          },
          crawl: {
            type: 'object',
            label: 'Web 抓取 / 检索 / 浏览器（crawl）',
            description:
              '驱动 web.web_fetch、web.web_search、browser 工作流。浏览器启动参数优先合并 renderer.playwright（data/server_bots/{port}/renderers/playwright/config.yaml）',
            component: 'SubForm',
            fields: {
              webFetch: {
                type: 'object',
                label: 'web_fetch',
                component: 'SubForm',
                fields: {
                  timeoutSeconds: {
                    type: 'number',
                    label: '超时（秒）',
                    min: 1,
                    default: 30,
                    component: 'InputNumber'
                  },
                  cacheTtlMinutes: {
                    type: 'number',
                    label: '缓存 TTL（分钟）',
                    min: 0,
                    default: 15,
                    component: 'InputNumber'
                  },
                  maxChars: {
                    type: 'number',
                    label: '正文最大字符',
                    min: 100,
                    default: 50000,
                    component: 'InputNumber'
                  },
                  maxResponseBytes: {
                    type: 'number',
                    label: '响应体最大字节',
                    min: 32000,
                    default: 2000000,
                    component: 'InputNumber'
                  },
                  maxRedirects: {
                    type: 'number',
                    label: '最大重定向次数',
                    min: 0,
                    default: 3,
                    component: 'InputNumber'
                  },
                  pinDns: {
                    type: 'boolean',
                    label: 'DNS pinning（SSRF 加固）',
                    default: true,
                    component: 'Switch'
                  },
                  readabilityEnabled: {
                    type: 'boolean',
                    label: 'Readability 提取',
                    default: true,
                    component: 'Switch'
                  },
                  userAgent: {
                    type: 'string',
                    label: 'User-Agent',
                    default: '',
                    component: 'Input',
                    layout: 'full'
                  },
                  firecrawlApiKey: {
                    type: 'string',
                    label: 'Firecrawl API Key（回退抓取）',
                    default: '',
                    component: 'Input',
                    layout: 'full'
                  },
                  firecrawlBaseUrl: {
                    type: 'string',
                    label: 'Firecrawl Base URL',
                    default: 'https://api.firecrawl.dev',
                    component: 'Input',
                    layout: 'full'
                  },
                  firecrawlEnabled: {
                    type: 'boolean',
                    label: '启用 Firecrawl 回退',
                    description: '留空则按是否配置 firecrawlApiKey 自动判断',
                    default: false,
                    component: 'Switch'
                  }
                }
              },
              webSearch: {
                type: 'object',
                label: 'web_search',
                component: 'SubForm',
                fields: {
                  enabled: {
                    type: 'boolean',
                    label: '启用 web_search',
                    default: true,
                    component: 'Switch'
                  },
                  provider: {
                    type: 'string',
                    label: '默认提供商',
                    description: '留空=auto-detect（无 Key 时 parallel-free）',
                    default: '',
                    component: 'Input'
                  },
                  timeoutSeconds: {
                    type: 'number',
                    label: '超时（秒）',
                    min: 1,
                    default: 20,
                    component: 'InputNumber'
                  },
                  cacheTtlMinutes: {
                    type: 'number',
                    label: '缓存 TTL（分钟）',
                    min: 0,
                    default: 15,
                    component: 'InputNumber'
                  },
                  region: {
                    type: 'string',
                    label: 'DuckDuckGo region',
                    default: '',
                    component: 'Input'
                  },
                  safeSearch: {
                    type: 'string',
                    label: 'DuckDuckGo SafeSearch',
                    enum: ['strict', 'moderate', 'off'],
                    default: 'moderate',
                    component: 'Select'
                  },
                  country: {
                    type: 'string',
                    label: '国家/地区（2 字母）',
                    default: '',
                    component: 'Input'
                  },
                  parallelFree: {
                    type: 'object',
                    label: 'parallel-free',
                    component: 'SubForm',
                    fields: {
                      url: {
                        type: 'string',
                        label: 'MCP URL',
                        default: 'https://search.parallel.ai/mcp',
                        component: 'Input',
                        layout: 'full'
                      }
                    }
                  },
                  brave: {
                    type: 'object',
                    label: 'Brave',
                    component: 'SubForm',
                    fields: crawlProviderApiFields()
                  },
                  perplexity: {
                    type: 'object',
                    label: 'Perplexity',
                    component: 'SubForm',
                    fields: {
                      ...crawlProviderApiFields(),
                      openRouterApiKey: {
                        type: 'string',
                        label: 'OpenRouter API Key（可选）',
                        default: '',
                        component: 'Input',
                        layout: 'full'
                      },
                      model: {
                        type: 'string',
                        label: 'Model（可选）',
                        default: '',
                        component: 'Input'
                      }
                    }
                  },
                  exa: {
                    type: 'object',
                    label: 'Exa',
                    component: 'SubForm',
                    fields: crawlProviderApiFields()
                  },
                  tavily: {
                    type: 'object',
                    label: 'Tavily',
                    component: 'SubForm',
                    fields: crawlProviderApiFields()
                  },
                  parallel: {
                    type: 'object',
                    label: 'Parallel（付费）',
                    component: 'SubForm',
                    fields: crawlProviderApiFields()
                  },
                  gemini: {
                    type: 'object',
                    label: 'Gemini',
                    component: 'SubForm',
                    fields: {
                      ...crawlProviderApiFields(),
                      model: {
                        type: 'string',
                        label: 'Model（可选）',
                        default: '',
                        component: 'Input'
                      }
                    }
                  },
                  kimi: {
                    type: 'object',
                    label: 'Kimi / Moonshot',
                    component: 'SubForm',
                    fields: {
                      ...crawlProviderApiFields(),
                      model: {
                        type: 'string',
                        label: 'Model（可选）',
                        default: '',
                        component: 'Input'
                      }
                    }
                  },
                  minimax: {
                    type: 'object',
                    label: 'MiniMax',
                    component: 'SubForm',
                    fields: {
                      ...crawlProviderApiFields(),
                      region: {
                        type: 'string',
                        label: 'Region',
                        enum: ['', 'global', 'cn'],
                        default: '',
                        component: 'Select'
                      },
                      apiHost: {
                        type: 'string',
                        label: 'API Host（可选，用于推断 cn）',
                        default: '',
                        component: 'Input',
                        layout: 'full'
                      }
                    }
                  },
                  firecrawl: {
                    type: 'object',
                    label: 'Firecrawl Search',
                    component: 'SubForm',
                    fields: crawlProviderApiFields()
                  },
                  searxng: {
                    type: 'object',
                    label: 'SearXNG',
                    component: 'SubForm',
                    fields: {
                      baseUrl: {
                        type: 'string',
                        label: '实例 Base URL',
                        default: '',
                        component: 'Input',
                        layout: 'full'
                      },
                      categories: {
                        type: 'string',
                        label: '默认 categories',
                        default: '',
                        component: 'Input'
                      },
                      language: {
                        type: 'string',
                        label: '默认 language',
                        default: '',
                        component: 'Input'
                      }
                    }
                  },
                  ollama: {
                    type: 'object',
                    label: 'Ollama',
                    component: 'SubForm',
                    fields: {
                      baseUrl: {
                        type: 'string',
                        label: 'Base URL',
                        default: 'http://127.0.0.1:11434',
                        component: 'Input',
                        layout: 'full'
                      },
                      apiKey: {
                        type: 'string',
                        label: '本地 API Key（可选）',
                        default: '',
                        component: 'Input',
                        layout: 'full'
                      },
                      cloudApiKey: {
                        type: 'string',
                        label: 'Ollama Cloud API Key（可选）',
                        default: '',
                        component: 'Input',
                        layout: 'full'
                      }
                    }
                  }
                }
              },
              browser: {
                type: 'object',
                label: 'browser MCP',
                description: '与 renderer.playwright 合并；此处可覆盖 MCP 专用限制',
                component: 'SubForm',
                fields: {
                  browserType: {
                    type: 'string',
                    label: '浏览器类型',
                    enum: ['chromium', 'firefox', 'webkit'],
                    default: 'chromium',
                    component: 'Select'
                  },
                  headless: {
                    type: 'boolean',
                    label: 'Headless',
                    default: true,
                    component: 'Switch'
                  },
                  wsEndpoint: {
                    type: 'string',
                    label: 'WebSocket 端点（远程连接）',
                    default: '',
                    component: 'Input',
                    layout: 'full'
                  },
                  executablePath: {
                    type: 'string',
                    label: '可执行文件路径',
                    default: '',
                    component: 'Input',
                    layout: 'full'
                  },
                  launchTimeoutMs: {
                    type: 'number',
                    label: '启动超时（毫秒）',
                    min: 5000,
                    default: 120000,
                    component: 'InputNumber'
                  },
                  navigationTimeoutMs: {
                    type: 'number',
                    label: '导航超时（毫秒）',
                    min: 1000,
                    default: 60000,
                    component: 'InputNumber'
                  },
                  maxTextChars: {
                    type: 'number',
                    label: 'page_text 最大字符',
                    min: 1000,
                    default: 50000,
                    component: 'InputNumber'
                  },
                  screenshotMaxBytes: {
                    type: 'number',
                    label: '截图最大字节',
                    min: 64000,
                    default: 4194304,
                    component: 'InputNumber'
                  },
                  screenshotFontDir: {
                    type: 'string',
                    label: '截图字体目录',
                    default: '',
                    component: 'Input',
                    layout: 'full'
                  },
                  screenshotFontUrlBase: {
                    type: 'string',
                    label: '截图字体虚拟 URL 前缀',
                    default: '',
                    component: 'Input',
                    layout: 'full'
                  },
                  screenshotFontFiles: {
                    type: 'array',
                    label: '截图字体文件',
                    itemType: 'string',
                    default: [],
                    component: 'Tags'
                  },
                  ssrfPolicy: {
                    type: 'object',
                    label: 'SSRF 策略',
                    component: 'SubForm',
                    fields: {
                      allowPrivateNetwork: {
                        type: 'boolean',
                        label: '允许私网',
                        default: false,
                        component: 'Switch'
                      },
                      dangerouslyAllowPrivateNetwork: {
                        type: 'boolean',
                        label: '危险：允许私网（内网）',
                        default: false,
                        component: 'Switch'
                      }
                    }
                  }
                }
              }
            }
          },
          tools: {
            type: 'object',
            label: '工具子系统（tools + desktop 文件 cwd）',
            description: 'tools.file 同时驱动 ToolsStream 与 DesktopStream 的文件类 MCP 工作区',
            component: 'SubForm',
            fields: {
              file: {
                type: 'object',
                label: '文件工具（tools 工作流）',
                description: '工作区路径、read 截断、run 开关与超时',
                component: 'SubForm',
                fields: {
                  workspace: {
                    type: 'string',
                    label: '文件工具工作区',
                    description: '留空=data/ai-workspace/{workspace.defaultId}；agent:xxx 指定 preset；project=项目根；~/ 家目录；绝对/相对路径',
                    default: '',
                    component: 'Input',
                    layout: 'full'
                  },
                  maxReadChars: {
                    type: 'number',
                    label: 'read 最大返回字符',
                    min: 1000,
                    default: 500000,
                    component: 'InputNumber'
                  },
                  grepMaxResults: {
                    type: 'number',
                    label: 'grep 最大匹配条数',
                    min: 1,
                    max: 500,
                    default: 100,
                    component: 'InputNumber'
                  },
                  runEnabled: {
                    type: 'boolean',
                    label: '允许 run 执行命令',
                    default: false,
                    component: 'Switch'
                  },
                  runTimeoutMs: {
                    type: 'number',
                    label: 'run 超时（毫秒）',
                    min: 1000,
                    default: 120000,
                    component: 'InputNumber'
                  },
                  maxCommandOutputChars: {
                    type: 'number',
                    label: 'run 标准输出最大字符',
                    min: 1000,
                    default: 200000,
                    component: 'InputNumber'
                  }
                }
              }
            }
          },
          subserver: {
            type: 'object',
            label: '多语言子服务端',
            description: 'Python/Go/PHP/Java/.NET 子服务地址；AgentRuntime.callSubserver 读取此处',
            component: 'SubForm',
            fields: {
              default: {
                type: 'string',
                label: '默认 runtime',
                description: '默认 pyserver runtime',
                component: 'Input',
                default: 'pyserver',
                placeholder: 'pyserver'
              },
              timeout: {
                type: 'number',
                label: '请求超时（毫秒）',
                component: 'InputNumber',
                default: 30000,
                min: 1000
              },
              runtimes: {
                type: 'object',
                label: '各 runtime 端点',
                component: 'SubForm',
                fields: subserverRuntimeSubFormFields()
              }
            }
          },
        }
      }
    }
