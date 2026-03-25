import AIStream from '#infrastructure/aistream/aistream.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import BotUtil from '#utils/botutil.js';
import { PlaywrightAgentSession, SsrFBlockedError } from '../lib/agent-browser/index.js';

/** Playwright 受控浏览器 MCP；配置 `aistream.tools.agentBrowser`。 */
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

  resolveAgentBrowserConfig() {
    const raw = getAistreamConfigOptional().tools?.agentBrowser ?? {};
    const navigationTimeoutMs =
      typeof raw.navigationTimeoutMs === 'number' && Number.isFinite(raw.navigationTimeoutMs)
        ? Math.max(5000, Math.floor(raw.navigationTimeoutMs))
        : 60_000;
    const maxTextChars =
      typeof raw.maxTextChars === 'number' && Number.isFinite(raw.maxTextChars)
        ? Math.max(500, Math.floor(raw.maxTextChars))
        : 50_000;
    const screenshotMaxBytes =
      typeof raw.screenshotMaxBytes === 'number' && Number.isFinite(raw.screenshotMaxBytes)
        ? Math.max(32_000, Math.floor(raw.screenshotMaxBytes))
        : 4 * 1024 * 1024;

    return {
      enabled: raw.enabled !== false,
      headless: raw.headless !== false,
      browserType: ['chromium', 'firefox', 'webkit'].includes(raw.browserType)
        ? raw.browserType
        : 'chromium',
      executablePath: typeof raw.executablePath === 'string' ? raw.executablePath.trim() : '',
      launchTimeoutMs:
        typeof raw.launchTimeoutMs === 'number' && Number.isFinite(raw.launchTimeoutMs)
          ? Math.max(5000, Math.floor(raw.launchTimeoutMs))
          : 120_000,
      navigationTimeoutMs,
      maxTextChars,
      screenshotMaxBytes,
      ssrfPolicy: {
        allowPrivateNetwork: raw.allowPrivateNetwork === true,
        dangerouslyAllowPrivateNetwork: raw.dangerouslyAllowPrivateNetwork === true
      }
    };
  }

  async init() {
    await super.init();
    this.registerBrowserTools();
  }

  async ensureSession() {
    const cfg = this.resolveAgentBrowserConfig();
    if (!cfg.enabled) {
      throw new Error('agentBrowser 已在 aistream.tools.agentBrowser 中禁用 (enabled: false)');
    }
    if (this.session) return this.session;
    const launchOpts = {
      browserType: cfg.browserType,
      headless: cfg.headless,
      launchTimeoutMs: cfg.launchTimeoutMs
    };
    if (cfg.executablePath) {
      launchOpts.executablePath = cfg.executablePath;
    }
    this.session = await PlaywrightAgentSession.launch(launchOpts);
    BotUtil.makeLog('info', `[${this.name}] Playwright 已启动 (${cfg.browserType}, headless=${cfg.headless})`, 'BrowserStream');
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
        const cfg = this.resolveAgentBrowserConfig();
        if (!cfg.enabled) {
          return this.errorResponse('BROWSER_DISABLED', 'aistream.tools.agentBrowser.enabled 为 false');
        }
        const u = this.session?.url?.() ?? '';
        return this.successResponse({
          running: Boolean(this.session),
          currentUrl: u || undefined,
          browserType: cfg.browserType,
          headless: cfg.headless
        });
      },
      enabled: true
    });

    this.registerMCPTool('browser_start', {
      description: '启动 Playwright 受控浏览器会话（幂等：已启动则直接返回成功）。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        try {
          const cfg = this.resolveAgentBrowserConfig();
          if (!cfg.enabled) {
            return this.errorResponse('BROWSER_DISABLED', 'aistream.tools.agentBrowser.enabled 为 false');
          }
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
        const cfg = this.resolveAgentBrowserConfig();
        if (!cfg.enabled) {
          return this.errorResponse('BROWSER_DISABLED', 'aistream.tools.agentBrowser.enabled 为 false');
        }
        const waitUntil = ['load', 'domcontentloaded', 'networkidle', 'commit'].includes(args.waitUntil)
          ? args.waitUntil
          : 'load';
        try {
          const s = await this.ensureSession();
          await s.goto(url, {
            waitUntil,
            timeoutMs: cfg.navigationTimeoutMs,
            ssrfPolicy: cfg.ssrfPolicy
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
          const cfg = this.resolveAgentBrowserConfig();
          const title = await this.session.title();
          let text = await this.session.textContent();
          let truncated = false;
          if (text.length > cfg.maxTextChars) {
            text = text.slice(0, cfg.maxTextChars);
            truncated = true;
          }
          return this.successResponse({ title, text, truncated, maxChars: cfg.maxTextChars });
        } catch (e) {
          return this.errorResponse('BROWSER_PAGE_TEXT_FAILED', e?.message || String(e));
        }
      },
      enabled: true
    });

    this.registerMCPTool('browser_screenshot', {
      description: '截取当前页 PNG（Base64）。体积受 aistream.tools.agentBrowser.screenshotMaxBytes 限制。',
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
          const cfg = this.resolveAgentBrowserConfig();
          const fullPage = args.fullPage === true;
          const buf = await this.session.screenshot({ fullPage, type: 'png' });
          if (buf.length > cfg.screenshotMaxBytes) {
            return this.errorResponse(
              'SCREENSHOT_TOO_LARGE',
              `PNG ${buf.length} 字节超过 screenshotMaxBytes=${cfg.screenshotMaxBytes}`
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
      '导航 URL 与 web_fetch 共用 SSRF 策略（私网默认禁止，除非配置开启）。',
      '需要渲染完整页面后再抓正文时请用 browser_goto + browser_page_text；仅需无 JS 的 HTTP 正文请优先 web 工作流 web_fetch。'
    ].join('\n');
  }

  async cleanup() {
    await this.closeSessionInternal();
    await super.cleanup();
  }
}
