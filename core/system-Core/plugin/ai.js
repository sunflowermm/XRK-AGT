/**
 * XRK AI 助手 — 对齐 XRK-Yunzai plugin/ai.js
 * @ 机器人 / 配置前缀 / 群内随机触发；合并 memory、tools 等工作流
 */
import RuntimeUtil from '#utils/runtime-util.js';
import {
  AI_FULL_PROMPT_DUMP_REGEX,
  handleClearConversation,
  loadAiAssistantConfig,
  logAiInit,
  processMessageContent,
  rawMessageTextForAiTrigger,
  resolveChatStream,
  runChatAgent,
  shouldTriggerAI,
  isInAiWhitelist,
} from '../lib/ai-assistant-runtime.js';

export class XRKAIAssistant extends PluginBase {
  constructor() {
    super({
      name: 'XRK-AI助手',
      dsc: '智能 AI 助手：@、前缀、随机触发，合并 Agent 工作流',
      event: 'message',
      priority: 99999,
      rule: [{ reg: '.*', fnc: 'handleMessage', log: false }],
    });
  }

  async init() {
    this.config = await loadAiAssistantConfig();
    logAiInit(this.config);
  }

  async handleMessage() {
    const e = this.e;
    try {
      // 每次触发重读，与 CommonConfig 热更对齐（ConfigBase 有缓存）
      this.config = await loadAiAssistantConfig();

      const msgText = String(e.msg || '').trim();
      const normalized = msgText.startsWith('#') ? msgText.slice(1).trim() : msgText;
      if (normalized === '清空对话') {
        if (!e.isMaster) {
          await e.reply('仅主人可以清空对话哦～');
          return true;
        }
        return handleClearConversation(e);
      }

      if (this.config.enabled === false) return false;

      const rawForDump = rawMessageTextForAiTrigger(e);
      const debugDumpFullPrompt = AI_FULL_PROMPT_DUMP_REGEX.test(rawForDump);
      if (debugDumpFullPrompt && !isInAiWhitelist(e, this.config)) {
        return false;
      }

      let trigger = true;
      if (!debugDumpFullPrompt) {
        trigger = await shouldTriggerAI(e, this.config);
      }
      if (!trigger) return false;

      const stream = resolveChatStream(this, this.config);
      if (!stream) {
        logger.error('[XRK-AI] chat 工作流未加载');
        return false;
      }

      const isRandom = !e.atBot && !(this.config.prefix && e.msg?.startsWith(this.config.prefix));
      const text = await processMessageContent(e, this.config);
      const isGlobalTrigger = isRandom && !debugDumpFullPrompt;

      if (!debugDumpFullPrompt && !isGlobalTrigger && !text) {
        const img = stream.getRandomEmotionImage?.('惊讶');
        if (img) await e.reply(msgSegment.image(img));
        await RuntimeUtil.sleep(300);
        await e.reply('有什么需要帮助的吗？');
        return true;
      }

      await runChatAgent(this, e, {
        text,
        persona: this.config.persona ?? '',
        config: this.config,
        isGlobalTrigger,
        debugDumpFullPrompt,
      });
      return true;
    } catch (err) {
      logger.error(`[XRK-AI] handleMessage: ${err.message}`);
      return false;
    }
  }
}
