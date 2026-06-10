import OpenAICompatibleLLMClient from './OpenAICompatibleLLMClient.js';
import { buildOpenAICompatEndpoint } from '../../utils/llm/openai-chat-utils.js';

/** CherryIN 兼容工厂（OpenAI Chat Completions） */
export default class CherryINCompatibleLLMClient extends OpenAICompatibleLLMClient {
  normalizeEndpoint(config) {
    return buildOpenAICompatEndpoint(config, { defaultPath: '/v1/chat/completions', label: 'cherryin_compat' });
  }
}
