import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import { PlaywrightAgentSession, SsrFBlockedError } from '../lib/agent-browser/index.js';

const BROWSER_DEFAULTS = Object.freeze({
  headless: true,
  browserType: 'chromium',
  launchTimeoutMs: 120_000,
  navigationTimeoutMs: 60_000,
  maxTextChars: 50_000,
  screenshotMaxBytes: 4 * 1024 * 1024,
  ssrfPolicy: {
    allowPrivateNetwork: false,
    dangerouslyAllowPrivateNetwork: false
  }
});

/** Playwright 受控浏览器 MCP。 */
export default class BrowserStream extends AIStream {
  /** @type {PlaywrightAgentSession | null} */
  session = null;

  constructor() {
    super({
      name: 'browser',
      description: 'Playwright 受控浏览器：导航、正文快照、截图（SSRF 与 web_fetch 一致）',
      version: '1.0.0',
      author: 'XRK',
      priority: 92,
      config: {
        enabled: true,
        temperature: 0.2,
        maxTokens: 8000,
        topP: 0.9
      },
      embedding: { enabled: false }
    });
  }

  async init() {
    await super.init();
    this.registerBrowserTools();
  }

  async ensureSession() {
    if (this.session) return this.session;
    const launchOpts = {
      browserType: BROWSER_DEFAULTS.browserType,
      headless: BROWSER_DEFAULTS.headless,
      launchTimeoutMs: BROWSER_DEFAULTS.launchTimeoutMs
    };
    this.session = await PlaywrightAgentSession.launch(launchOpts);
    BotUtil.makeLog(
      'info',
      `[${this.name}] Playwright 已启动 (${BROWSER_DEFAULTS.browserType}, headless=${BROWSER_DEFAULTS.headless})`,
      'BrowserStream'
    );
    return this.session;
  }

  async closeSessionInternal() {
    if (this.session) {
      await this.session.close().catch(() => {});
      this.session = null;
      BotUtil.makeLog('debug', `[${this.name}] Playwright 已关闭`, 'BrowserStream');
    }
  }

  registerBrowserTools() {
    this.registerMCPTool('browser_status', {
      description: '查询受控浏览器会话是否已启动（不自动启动浏览器）。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const u = this.session?.url?.() ?? '';
        return this.successResponse({
          running: Boolean(this.session),
          currentUrl: u || undefined,
          browserType: BROWSER_DEFAULTS.browserType,
          headless: BROWSER_DEFAULTS.headless
        });
      },
      enabled: true
    });

    this.registerMCPTool('browser_start', {
      description: '启动 Playwright 受控浏览器会话（幂等：已启动则直接返回成功）。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        try {
          await this.ensureSession();
          return this.successResponse({ message: '浏览器会话已就绪' });
        } catch (e) {
          const msg = e?.message || String(e);
          BotUtil.makeLog('error', `[${this.name}] browser_start: ${msg}`, 'BrowserStream');
          return this.errorResponse('BROWSER_START_FAILED', msg);
        }
      },
      enabled: true
    });

    this.registerMCPTool('browser_goto', {
      description:
        '在受控浏览器中导航到 URL（http/https）。未启动时会自动启动。受 SSRF 与 web_fetch 相同策略约束。',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标 URL' },
          waitUntil: {
            type: 'string',
            enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
            description: 'Playwright waitUntil'
          }
        },
        required: ['url']
      },
      handler: async (args = {}) => {
        const url = typeof args.url === 'string' ? args.url.trim() : '';
        if (!url) return this.errorResponse('INVALID_PARAM', 'url 必填');
        const waitUntil = ['load', 'domcontentloaded', 'networkidle', 'commit'].includes(args.waitUntil)
          ? args.waitUntil
          : 'load';
        try {
          const s = await this.ensureSession();
          await s.goto(url, {
            waitUntil,
            timeoutMs: BROWSER_DEFAULTS.navigationTimeoutMs,
            ssrfPolicy: BROWSER_DEFAULTS.ssrfPolicy
          });
          const title = await s.title();
          return this.successResponse({ url, title });
        } catch (e) {
          if (e instanceof SsrFBlockedError || e?.name === 'SsrFBlockedError') {
            return this.errorResponse('SSRF_BLOCKED', e.message);
          }
          const msg = e?.message || String(e);
          BotUtil.makeLog('error', `[${this.name}] browser_goto: ${msg}`, 'BrowserStream');
          return this.errorResponse('BROWSER_GOTO_FAILED', msg);
        }
      },
      enabled: true
    });

    this.registerMCPTool('browser_page_text', {
      description: '读取当前页标题与可见正文（body innerText，超长按配置截断）。需已导航。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        try {
          if (!this.session) {
            return this.errorResponse('NO_SESSION', '请先 browser_start 或 browser_goto');
          }
          const title = await this.session.title();
          let text = await this.session.textContent();
          let truncated = false;
          if (text.length > BROWSER_DEFAULTS.maxTextChars) {
            text = text.slice(0, BROWSER_DEFAULTS.maxTextChars);
            truncated = true;
          }
          return this.successResponse({ title, text, truncated, maxChars: BROWSER_DEFAULTS.maxTextChars });
        } catch (e) {
          return this.errorResponse('BROWSER_PAGE_TEXT_FAILED', e?.message || String(e));
        }
      },
      enabled: true
    });

    this.registerMCPTool('browser_screenshot', {
      description: '截取当前页 PNG（Base64）。',
      inputSchema: {
        type: 'object',
        properties: {
          fullPage: { type: 'boolean', description: '是否整页截图', default: false }
        },
        required: []
      },
      handler: async (args = {}) => {
        try {
          if (!this.session) {
            return this.errorResponse('NO_SESSION', '请先 browser_start 或 browser_goto');
          }
          const fullPage = args.fullPage === true;
          const buf = await this.session.screenshot({ fullPage, type: 'png' });
          if (buf.length > BROWSER_DEFAULTS.screenshotMaxBytes) {
            return this.errorResponse(
              'SCREENSHOT_TOO_LARGE',
              `PNG ${buf.length} 字节超过 screenshotMaxBytes=${BROWSER_DEFAULTS.screenshotMaxBytes}`
            );
          }
          return this.successResponse({
            mimeType: 'image/png',
            base64: buf.toString('base64'),
            bytes: buf.length,
            fullPage
          });
        } catch (e) {
          return this.errorResponse('BROWSER_SCREENSHOT_FAILED', e?.message || String(e));
        }
      },
      enabled: true
    });

    this.registerMCPTool('browser_close', {
      description: '关闭 Playwright 浏览器会话并释放进程。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        await this.closeSessionInternal();
        return this.successResponse({ message: '已关闭' });
      },
      enabled: true
    });
  }

  buildSystemPrompt() {
    return [
      '本工作流提供受控浏览器（Playwright）MCP 工具：browser_status、browser_start、browser_goto、browser_page_text、browser_screenshot、browser_close。',
      '导航 URL 与 web_fetch 共用 SSRF 策略（默认禁止私网）。',
      '需要渲染完整页面后再抓正文时请用 browser_goto + browser_page_text；仅需无 JS 的 HTTP 正文请优先 web 工作流 web_fetch。'
    ].join('\n');
  }

  async cleanup() {
    await this.closeSessionInternal();
    await super.cleanup();
  }
}
