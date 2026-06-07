import VolcengineLLMClient from './VolcengineLLMClient.js';
import XiaomiMiMoLLMClient from './XiaomiMiMoLLMClient.js';
import OpenAILLMClient from './OpenAILLMClient.js';
import GeminiLLMClient from './GeminiLLMClient.js';
import AnthropicLLMClient from './AnthropicLLMClient.js';
import AzureOpenAILLMClient from './AzureOpenAILLMClient.js';
import OpenAICompatibleLLMClient from './OpenAICompatibleLLMClient.js';
import OpenAIResponsesCompatibleLLMClient from './OpenAIResponsesCompatibleLLMClient.js';
import NewAPICompatibleLLMClient from './NewAPICompatibleLLMClient.js';
import CherryINCompatibleLLMClient from './CherryINCompatibleLLMClient.js';
import OllamaCompatibleLLMClient from './OllamaCompatibleLLMClient.js';
import GeminiCompatibleLLMClient from './GeminiCompatibleLLMClient.js';
import AnthropicCompatibleLLMClient from './AnthropicCompatibleLLMClient.js';
import AzureOpenAICompatibleLLMClient from './AzureOpenAICompatibleLLMClient.js';

const builtinClientFactories = new Map([
  ['volcengine', (config) => new VolcengineLLMClient(config)],
  ['xiaomimimo', (config) => new XiaomiMiMoLLMClient(config)],
  ['openai', (config) => new OpenAILLMClient(config)],
  ['gemini', (config) => new GeminiLLMClient(config)],
  ['anthropic', (config) => new AnthropicLLMClient(config)],
  ['azure_openai', (config) => new AzureOpenAILLMClient(config)]
]);

/** 所有 LLM 工厂统一从 providers[] 解析；YAML 默认仅 providers: [] */
const factoryRegistry = [
  { configKey: 'volcengine_llm', factoryType: 'builtin', protocol: 'volcengine' },
  { configKey: 'xiaomimimo_llm', factoryType: 'builtin', protocol: 'xiaomimimo' },
  { configKey: 'openai_llm', factoryType: 'builtin', protocol: 'openai' },
  { configKey: 'gemini_llm', factoryType: 'builtin', protocol: 'gemini' },
  { configKey: 'anthropic_llm', factoryType: 'builtin', protocol: 'anthropic' },
  { configKey: 'azure_openai_llm', factoryType: 'builtin', protocol: 'azure_openai' },
  { configKey: 'openai_compat_llm', factoryType: 'compat', defaultProtocol: 'openai', clientClass: OpenAICompatibleLLMClient },
  { configKey: 'openai_responses_compat_llm', factoryType: 'compat', defaultProtocol: 'openai-response', clientClass: OpenAIResponsesCompatibleLLMClient },
  { configKey: 'newapi_compat_llm', factoryType: 'compat', defaultProtocol: 'new-api', clientClass: NewAPICompatibleLLMClient },
  { configKey: 'cherryin_compat_llm', factoryType: 'compat', defaultProtocol: 'cherryin', clientClass: CherryINCompatibleLLMClient },
  { configKey: 'ollama_compat_llm', factoryType: 'compat', defaultProtocol: 'ollama', clientClass: OllamaCompatibleLLMClient },
  { configKey: 'gemini_compat_llm', factoryType: 'compat', defaultProtocol: 'gemini', clientClass: GeminiCompatibleLLMClient },
  { configKey: 'anthropic_compat_llm', factoryType: 'compat', defaultProtocol: 'anthropic', clientClass: AnthropicCompatibleLLMClient },
  { configKey: 'azure_openai_compat_llm', factoryType: 'compat', defaultProtocol: 'azure-openai', clientClass: AzureOpenAICompatibleLLMClient }
];

function normalizeProviderKey(name) {
  return (name || '').toString().trim().toLowerCase();
}

function resolveDefaultProvider() {
  return normalizeProviderKey(global.cfg?.aistream?.llm?.Provider || global.cfg?.aistream?.llm?.provider);
}

function normalizeProtocol(value) {
  const protocol = normalizeProviderKey(value);
  if (protocol === 'openai-responses') return 'openai-response';
  return protocol;
}

function getProviderEntries() {
  const entries = [];

  for (const factory of factoryRegistry) {
    const factoryCfg = global.cfg?.[factory.configKey] || {};
    const providerList = Array.isArray(factoryCfg.providers) ? factoryCfg.providers : [];

    for (const providerEntry of providerList) {
      const key = normalizeProviderKey(providerEntry.key || providerEntry.provider);
      if (!key) continue;

      const protocol = normalizeProtocol(
        providerEntry.protocol || factory.protocol || factory.defaultProtocol
      );

      entries.push({
        key,
        protocol,
        factory,
        entry: providerEntry
      });
    }
  }

  return entries;
}

export default class LLMFactory {
  static registerProvider(name, factoryFn) {
    builtinClientFactories.set(String(name).toLowerCase(), factoryFn);
  }

  static listProviders() {
    return getProviderEntries().map((x) => x.key);
  }

  static listProviderProfiles() {
    return getProviderEntries().map(({ key, protocol, factory, entry }) => ({
      key,
      factory: factory.configKey.replace(/_llm$/, '').replace(/_compat_llm$/, ''),
      factoryType: factory.factoryType,
      protocol,
      label: entry.label || key,
      model: entry.model || entry.chatModel || entry.deployment || null,
      baseUrl: entry.baseUrl || null,
      source: `${factory.configKey}.providers[]`
    }));
  }

  static hasProvider(name) {
    return !!this.getProviderConfig(name);
  }

  static resolveProvider(input = {}, options = {}) {
    const allowDefaultAliases = options.allowDefaultAliases !== false;
    const isDefaultAlias = (v) => {
      const s = normalizeProviderKey(v);
      return s === 'default' || s === 'auto';
    };

    const candidates = [
      input.provider,
      input.model,
      input.llm,
      input.profile,
      input.defaultProvider,
      resolveDefaultProvider()
    ];

    for (const candidate of candidates) {
      const key = normalizeProviderKey(candidate);
      if (!key) continue;
      if (allowDefaultAliases && isDefaultAlias(key)) continue;
      if (this.hasProvider(key)) return key;
    }

    return null;
  }

  static getProviderConfig(providerName) {
    const key = normalizeProviderKey(providerName);
    if (!key) return null;

    const matched = getProviderEntries().find((x) => x.key === key);
    if (!matched) return null;

    const { factory, entry, protocol } = matched;

    return {
      ...entry,
      provider: key,
      protocol,
      factoryType: factory.factoryType,
      factory: factory.configKey.replace(/_llm$/, '').replace(/_compat_llm$/, ''),
      _clientClass: factory.clientClass || null
    };
  }

  static createClient(config = {}) {
    const provider = this.resolveProvider(config, { allowDefaultAliases: true });
    if (!provider) {
      throw new Error('未指定 LLM 提供商：请在各工厂 providers[] 中添加端点，并在 aistream.yaml 配置 llm.Provider');
    }

    const resolved = this.getProviderConfig(provider);
    if (!resolved) {
      throw new Error(`不支持的 LLM 提供商: ${provider}`);
    }

    const sanitizedConfig = {};
    for (const [key, value] of Object.entries(config || {})) {
      if (value !== undefined) {
        sanitizedConfig[key] = value;
      }
    }

    const clientConfig = {
      ...resolved,
      ...sanitizedConfig,
      provider,
      protocol: normalizeProtocol(sanitizedConfig.protocol || resolved.protocol) || resolved.protocol
    };

    const { _clientClass, factory, factoryType, ...rest } = clientConfig;

    const builtinFactory = builtinClientFactories.get(rest.protocol);
    if (builtinFactory) {
      return builtinFactory(rest);
    }

    const ClientClass = _clientClass || OpenAICompatibleLLMClient;
    return new ClientClass(rest);
  }
}
