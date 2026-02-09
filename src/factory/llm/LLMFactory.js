import GPTGodLLMClient from './GPTGodLLMClient.js';
import VolcengineLLMClient from './VolcengineLLMClient.js';
import XiaomiMiMoLLMClient from './XiaomiMiMoLLMClient.js';
import OpenAILLMClient from './OpenAILLMClient.js';
import GeminiLLMClient from './GeminiLLMClient.js';
import OpenAICompatibleLLMClient from './OpenAICompatibleLLMClient.js';
import AnthropicLLMClient from './AnthropicLLMClient.js';
import AzureOpenAILLMClient from './AzureOpenAILLMClient.js';

const providers = new Map([
  // GPTGod：默认内置提供商，支持多模态与流式输出
  ['gptgod', (config) => new GPTGodLLMClient(config)],
  // 火山引擎豆包：兼容 OpenAI Chat Completions 风格（/api/v3/chat/completions）
  ['volcengine', (config) => new VolcengineLLMClient(config)],
  // 小米 MiMo：兼容 OpenAI API 的 MiMo 大模型
  ['xiaomimimo', (config) => new XiaomiMiMoLLMClient(config)],
  // OpenAI 官方：Chat Completions
  ['openai', (config) => new OpenAILLMClient(config)],
  // Google Gemini 官方：Generative Language API
  ['gemini', (config) => new GeminiLLMClient(config)],
  // OpenAI 兼容第三方：任意 OpenAI-like Chat Completions（可自定义 baseUrl/path/认证/额外参数）
  ['openai_compat', (config) => new OpenAICompatibleLLMClient(config)],
  // Anthropic 官方（Claude）：Messages API
  ['anthropic', (config) => new AnthropicLLMClient(config)],
  // Azure OpenAI 官方：deployment + api-version 体系
  ['azure_openai', (config) => new AzureOpenAILLMClient(config)]
]);

export default class LLMFactory {
  /**
   * 注册自定义 LLM 提供商
   * @param {string} name - 提供商名称
   * @param {Function} factoryFn - 工厂函数，接收 config 参数，返回 LLM 客户端实例
   */
  static registerProvider(name, factoryFn) {
    providers.set(String(name).toLowerCase(), factoryFn);
  }

  /**
   * 列出所有已注册的提供商
   * @returns {Array<string>} 提供商名称列表
   */
  static listProviders() {
    return Array.from(providers.keys());
  }

  /**
   * 检查提供商是否存在
   * @param {string} name - 提供商名称
   * @returns {boolean} 是否存在
   */
  static hasProvider(name) {
    return providers.has((name ?? '').toLowerCase());
  }

  /**
   * 创建 LLM 客户端
   * @param {Object} config - 配置对象
   *   - provider: 提供商名称（如 'gptgod', 'volcengine'）
   *   - baseUrl: API 基础地址
   *   - apiKey: API 密钥
   *   - 其他 LLM 参数
   * @returns {Object} LLM 客户端实例
   */
  static createClient(config = {}) {
    const provider = (config.provider || 'gptgod').toLowerCase();
    const factory = providers.get(provider);

    if (!factory) {
      Bot.makeLog?.('error', `[LLMFactory] 不支持的提供商: ${provider}`);
      throw new Error(`不支持的LLM提供商: ${provider}`);
    }

    const client = factory(config);
    Bot.makeLog?.('debug', `[LLMFactory] 创建客户端成功: provider=${provider}, client=${client?.constructor?.name || 'unknown'}`);
    return client;
  }
}
