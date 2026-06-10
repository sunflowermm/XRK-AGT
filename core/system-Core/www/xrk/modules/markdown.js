/**
 * Markdown 渲染模块
 * 提供 Markdown 到 HTML 的转换和语法高亮功能
 */

import { escapeHtml, copyToClipboard } from './utils.js';

const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

function encodeRawCode(code) {
  try {
    return btoa(unescape(encodeURIComponent(String(code ?? ''))));
  } catch {
    return '';
  }
}

function decodeRawCode(b64) {
  if (!b64) return '';
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return '';
  }
}

function getCodeText(codeEl) {
  if (!codeEl) return '';
  const b64 = codeEl.dataset.rawB64;
  if (b64) return decodeRawCode(b64);
  return String(codeEl.textContent || '').replace(/\n$/, '');
}

async function runCopyAction(button, labelSpan, text, { ok = '已复制', fail = '复制失败', restoreMs = 1400 } = {}) {
  const original = labelSpan?.textContent || button.textContent || '复制';
  const okResult = await copyToClipboard(text);
  const next = okResult ? ok : fail;
  if (labelSpan) labelSpan.textContent = next;
  else button.textContent = next;
  setTimeout(() => {
    if (labelSpan) labelSpan.textContent = original;
    else button.textContent = original;
  }, restoreMs);
  return okResult;
}

function wrapParagraphs(html) {
  let out = html.replace(/\n\n/g, '</p><p>');
  out = `<p>${out}</p>`;
  out = out.replace(/<p>\s*<\/p>/g, '');
  out = out.replace(/<p>\s*(<(?:h[1-6]|ul|ol|blockquote|hr)\b[^>]*>)/g, '$1');
  out = out.replace(/(<\/(?:h[1-6]|ul|ol|blockquote)>|<hr[^>]*>)\s*<\/p>/g, '$1');
  return out;
}

function unwrapBlockElements(html) {
  return html
    .replace(/<p>\s*(<(?:pre|div)\b[^>]*>)/g, '$1')
    .replace(/(<\/(?:pre|div)>)\s*<\/p>/g, '$1');
}

/** LLM 常把多行表格压成 `||` 分隔的单行 */
function normalizeCompactTableLines(text) {
  return String(text).replace(/^([^\n]*\|[^\n]*\|\|[^\n]+)$/gm, (line) =>
    line.split(/\s*\|\|\s*/).map((part) => part.trim()).filter(Boolean).join('\n')
  );
}

function splitTableCells(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed.includes('|')) return [];
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

function isTableSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function isTableLine(line) {
  const t = String(line ?? '').trim();
  if (!t.includes('|')) return false;
  return t.startsWith('|') || (t.match(/\|/g) || []).length >= 2;
}

function formatInlineMarkdown(text) {
  let s = escapeHtml(String(text ?? ''));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return s;
}

function renderTableBlock(lines) {
  const rows = lines.map(splitTableCells).filter((r) => r.some((c) => c !== ''));
  if (rows.length < 2) return null;

  let headHtml = '';
  let bodyStart = 0;
  if (isTableSeparatorRow(rows[1])) {
    headHtml = `<thead><tr>${rows[0].map((c) => `<th>${formatInlineMarkdown(c)}</th>`).join('')}</tr></thead>`;
    bodyStart = 2;
  }

  const bodyRows = rows.slice(bodyStart);
  if (!bodyRows.length) return null;

  const bodyHtml = bodyRows.map((r) =>
    `<tr>${r.map((c) => `<td>${formatInlineMarkdown(c)}</td>`).join('')}</tr>`
  ).join('');

  return `<div class="md-table-wrap"><table class="md-table">${headHtml}<tbody>${bodyHtml}</tbody></table></div>`;
}

function extractTables(text) {
  const tables = [];
  const lines = text.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    if (isTableLine(lines[i])) {
      const block = [];
      while (i < lines.length && isTableLine(lines[i])) {
        block.push(lines[i]);
        i += 1;
      }
      const html = renderTableBlock(block);
      if (html) {
        const id = `@@TABLE${tables.length}@@`;
        tables.push(html);
        out.push(id);
      } else {
        out.push(...block);
      }
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }

  return { text: out.join('\n'), tables };
}

/**
 * Markdown 渲染器类
 */
export class MarkdownRenderer {
  constructor() {
    this.mermaidInitialized = false;
  }

  /**
   * 初始化 Mermaid
   */
  initMermaid() {
    if (this.mermaidInitialized || !window.mermaid) return;
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        securityLevel: 'loose',
        flowchart: { useMaxWidth: true, htmlLabels: true }
      });
      this.mermaidInitialized = true;
    } catch (e) {
      console.warn('Mermaid 初始化失败:', e);
    }
  }

  /**
   * 在容器中渲染 Mermaid 图表
   * @param {Element} container - 容器元素
   */
  async renderMermaidIn(container) {
    if (!container) return;
    try {
      if (window.mermaid) {
        const nodes = container.querySelectorAll('pre code.language-mermaid');
        const targets = Array.from(nodes).filter(node => !node.dataset.processed);

        for (const node of targets) {
          const code = String(node.textContent || '').trim();
          if (!code) continue;
          const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          try {
            const { svg } = await window.mermaid.render(id, code);
            const wrapper = document.createElement('div');
            wrapper.className = 'md-mermaid';
            wrapper.setAttribute('data-mermaid-raw-b64', encodeRawCode(code));
            wrapper.innerHTML = svg;
            node.parentElement.replaceWith(wrapper);
            node.dataset.processed = 'true';
          } catch (err) {
            // Mermaid 语法异常时保留原始代码块，避免出现空白或占位符残留
            console.warn('Mermaid 节点渲染失败:', err);
          }
        }

        this.bindMermaidToolbar(container);
      }
    } catch (e) {
      console.warn('Mermaid 渲染失败:', e);
    } finally {
      this.bindCodeBlockToolbar(container);
    }
  }

  /**
   * 为 Markdown 代码块绑定复制工具栏
   * @param {Element} root - 根元素
   */
  bindCodeBlockToolbar(root) {
    if (!root) return;
    const pres = root.querySelectorAll('pre.md-code:not([data-code-toolbar-bound])');
    if (!pres.length) return;

    pres.forEach((pre) => {
      const codeEl = pre.querySelector('code');
      if (!codeEl) return;

      const lang = (codeEl.dataset.lang || codeEl.className.match(/language-(\S+)/)?.[1] || '').trim();
      if (lang === 'mermaid') return;

      pre.dataset.codeToolbarBound = 'true';

      const wrap = document.createElement('div');
      wrap.className = 'md-code-wrap';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const toolbar = document.createElement('div');
      toolbar.className = 'md-code-toolbar';
      toolbar.innerHTML = `
        <span class="md-code-lang">${lang ? escapeHtml(lang) : 'code'}</span>
        <button class="md-code-copy" type="button" title="复制代码" aria-label="复制代码">
          ${COPY_ICON_SVG}<span>复制</span>
        </button>
      `;
      wrap.insertBefore(toolbar, pre);

      const copyBtn = toolbar.querySelector('.md-code-copy');
      if (!copyBtn) return;

      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const raw = getCodeText(codeEl);
        if (!raw) return;
        await runCopyAction(copyBtn, copyBtn.querySelector('span'), raw);
      });

      pre.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const range = document.createRange();
        range.selectNodeContents(codeEl);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });
    });

    root.querySelectorAll('code.md-inline:not([data-inline-copy-bound])').forEach((inline) => {
      inline.dataset.inlineCopyBound = 'true';
      inline.title = '点击复制';
      inline.addEventListener('click', async (e) => {
        e.stopPropagation();
        const raw = String(inline.textContent || '').trim();
        if (!raw) return;
        inline.classList.add('md-inline-copied');
        await runCopyAction(inline, null, raw, { ok: '✓', fail: '×', restoreMs: 900 });
        setTimeout(() => inline.classList.remove('md-inline-copied'), 900);
      });
    });
  }

  /**
   * 绑定 Mermaid 工具栏
   * @param {Element} root - 根元素
   */
  bindMermaidToolbar(root) {
    if (!root) return;
    const wrappers = root.querySelectorAll('.md-mermaid');
    if (!wrappers.length) return;

    wrappers.forEach(wrap => {
      if (wrap.dataset._toolbarBound) return;
      wrap.dataset._toolbarBound = 'true';

      const toolbar = document.createElement('div');
      toolbar.className = 'md-mermaid-toolbar';
      toolbar.innerHTML = `
        <button class="md-mermaid-copy" type="button" title="复制 Mermaid 源码" aria-label="复制 Mermaid 源码">
          复制
        </button>
        <button class="md-mermaid-download" type="button" title="下载高清 PNG（失败时回退 SVG）" aria-label="下载高清 PNG">
          下载高清
        </button>
      `;
      wrap.prepend(toolbar);

      const copyBtn = toolbar.querySelector('.md-mermaid-copy');
      const downloadBtn = toolbar.querySelector('.md-mermaid-download');

      if (copyBtn) {
        copyBtn.innerHTML = `${COPY_ICON_SVG}<span>复制</span>`;
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const raw = decodeRawCode(wrap.getAttribute('data-mermaid-raw-b64'))
            || (wrap.getAttribute('data-mermaid-raw') || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
          if (!raw) return;
          await runCopyAction(copyBtn, copyBtn.querySelector('span'), raw);
        });
      }

      if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
          const svg = wrap.querySelector('svg');
          if (!svg) return;
          const cloned = svg.cloneNode(true);
          let width = Number(cloned.getAttribute('width')) || 0;
          let height = Number(cloned.getAttribute('height')) || 0;
          const vb = cloned.viewBox && cloned.viewBox.baseVal;
          if (vb && vb.width && vb.height) {
            width = vb.width;
            height = vb.height;
            cloned.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
          } else {
            const rect = svg.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
          }
          if (!width || !height) return;
          cloned.setAttribute('width', String(width));
          cloned.setAttribute('height', String(height));
          const xml = new XMLSerializer().serializeToString(cloned);
          const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
          const svgUrl = URL.createObjectURL(svgBlob);

          const downloadSvg = () => {
            const a = document.createElement('a');
            a.href = svgUrl;
            a.download = `mermaid-${Date.now()}.svg`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(svgUrl), 2000);
          };

          try {
            const scale = 3;
            const img = new Image();
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              img.src = svgUrl;
            });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const ctx = canvas.getContext('2d');
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) {
              downloadSvg();
              return;
            }
            const a = document.createElement('a');
            const pngUrl = URL.createObjectURL(blob);
            a.href = pngUrl;
            a.download = `mermaid-${Date.now()}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(pngUrl), 2000);
            URL.revokeObjectURL(svgUrl);
          } catch {
            downloadSvg();
          }
        });
      }
    });
  }

  /**
   * 渲染 Markdown 为 HTML
   * @param {string} text - Markdown 文本
   * @returns {string} HTML 字符串
   */
  render(text) {
    if (!text) return '';

    let working = normalizeCompactTableLines(text);

    const codeBlocks = [];
    working = working.replace(/```([^\n\r`]*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
      const id = `@@CODEBLOCK${codeBlocks.length}@@`;
      codeBlocks.push({ lang: lang || '', code });
      return id;
    });

    const inlineCodes = [];
    working = working.replace(/`([^`]+)`/g, (_, code) => {
      const id = `@@INLINECODE${inlineCodes.length}@@`;
      inlineCodes.push(code);
      return id;
    });

    const { text: withoutTables, tables } = extractTables(working);
    let html = withoutTables;

    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    html = html.replace(/^> (.+)$/gm, '<blockquote class="md-quote"><p class="md-quote-line">$1</p></blockquote>');

    html = html.replace(/^---$/gm, '<hr class="md-hr">');
    html = html.replace(/^\*\*\*$/gm, '<hr class="md-hr">');

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="md-img" src="$2" alt="$1">');

    inlineCodes.forEach((code, i) => {
      html = html.replace(`@@INLINECODE${i}@@`, `<code class="md-inline">${escapeHtml(code)}</code>`);
    });

    // 段落换行须在代码块/表格还原前处理，避免破坏 <pre> 内换行
    html = wrapParagraphs(html);

    codeBlocks.forEach((block, i) => {
      const lang = block.lang || '';
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
      const langClass = lang ? `language-${escapeHtml(lang)}` : 'language-plaintext';
      const rawB64 = encodeRawCode(block.code);
      const highlighted = this.syntaxHighlight(block.code, lang);
      html = html.replace(
        `@@CODEBLOCK${i}@@`,
        `<pre class="md-code"><code class="${langClass}"${langAttr} data-raw-b64="${rawB64}">${highlighted}</code></pre>`
      );
    });

    tables.forEach((tableHtml, i) => {
      html = html.replace(`@@TABLE${i}@@`, tableHtml);
    });

    html = unwrapBlockElements(html);

    return html;
  }

  /**
   * 语法高亮
   * @param {string} code - 代码
   * @param {string} lang - 语言
   * @returns {string} 高亮后的 HTML
   */
  syntaxHighlight(code, lang) {
    if (!code) return '';

    const escaped = escapeHtml(code);

    // 简单的语法高亮（可以集成 highlight.js 或 Prism.js）
    if (lang === 'javascript' || lang === 'js') {
      return escaped
        .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(true|false|null|undefined)\b/g, '<span class="literal">$1</span>')
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/('.*?'|".*?")/g, '<span class="string">$1</span>');
    }

    if (lang === 'json') {
      return escaped
        .replace(/(".*?"):/g, '<span class="property">$1</span>:')
        .replace(/:\s*(".*?")/g, ': <span class="string">$1</span>')
        .replace(/:\s*(\d+)/g, ': <span class="number">$1</span>')
        .replace(/:\s*(true|false|null)/g, ': <span class="literal">$1</span>');
    }

    if (lang === 'python' || lang === 'py') {
      return escaped
        .replace(/\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|pass|break|continue|raise|yield|lambda|global|nonlocal|assert|del|in|is|not|and|or)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(True|False|None)\b/g, '<span class="literal">$1</span>')
        .replace(/(#.*$)/gm, '<span class="comment">$1</span>')
        .replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|f?r?['"][^'"]*['"])/g, '<span class="string">$1</span>');
    }

    if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      return escaped
        .replace(/(#.*$)/gm, '<span class="comment">$1</span>')
        .replace(/\b(if|then|else|fi|for|do|done|echo|export|cd|python|npm|git)\b/g, '<span class="keyword">$1</span>');
    }

    return escaped;
  }

  /**
   * 渲染示例块
   * @param {string} example - 示例文本
   * @returns {string} HTML 字符串
   */
  renderExampleBlock(example) {
    if (!example) return '';
    try {
      const formatted = typeof example === 'string' ? example : JSON.stringify(example, null, 2);
      return `<pre class="example-block"><code>${escapeHtml(formatted)}</code></pre>`;
    } catch (e) {
      return `<pre class="example-block"><code>${escapeHtml(String(example))}</code></pre>`;
    }
  }
}

/**
 * 为TTS准备的纯文本：彻底去除所有Markdown标记，避免读出符号
 * @param {string} text - 原始Markdown文本
 * @returns {string} 纯文本
 */
export function stripMarkdownForTTS(text = '') {
  if (!text) return '';
  let s = String(text);

  // 1. 代码块 ```code``` 或 ```lang code``` - 完全移除
  s = s.replace(/```[\w]*\n?[\s\S]*?```/g, '');

  // 2. 行内代码 `code` - 保留内容，去掉反引号
  s = s.replace(/`([^`\n]+)`/g, '$1');

  // 3. 链接 [text](url) -> text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 4. 图片 ![alt](url) -> alt（如果有alt文本）
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // 5. 标题 # ## ### 等 - 移除标记，保留文本
  s = s.replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '$1');

  // 6. 粗体 **text** 或 __text__ - 保留内容
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');

  // 7. 斜体 *text* 或 _text_ - 保留内容（需在粗体之后处理）
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
  s = s.replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');

  // 8. 删除线 ~~text~~ - 保留内容
  s = s.replace(/~~([^~]+)~~/g, '$1');

  // 9. 任务列表 - [ ] 或 [x] - 移除标记
  s = s.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+\[[ xX]\]\s+/gm, '');

  // 10. 无序列表 - * - + - 移除标记
  s = s.replace(/^\s*[-*+]\s+/gm, '');

  // 11. 有序列表 1. 2. 等 - 移除标记
  s = s.replace(/^\s*\d+\.\s+/gm, '');

  // 12. 引用 > - 移除标记
  s = s.replace(/^\s*>+\s?/gm, '');

  // 13. 分隔线 --- 或 *** - 完全移除
  s = s.replace(/^\s*[-*_]{3,}\s*$/gm, '');

  // 14. 表格标记 | - 移除表格结构，保留内容
  s = s.replace(/\|/g, ' ');
  s = s.replace(/^\s*:?-+:?\s*$/gm, ''); // 表格分隔行

  // 15. HTML标签（如果有） - 移除
  s = s.replace(/<[^>]+>/g, '');

  // 16. 多余空白压缩：多个空格/制表符 -> 单个空格
  s = s.replace(/[ \t]+/g, ' ');

  // 17. 多个换行 -> 单个空格
  s = s.replace(/\s*\n+\s*/g, ' ');

  // 18. 移除行首行尾空白
  return s.trim();
}

/**
 * 从已渲染的聊天气泡中提取可复制的纯文本（保留代码块换行）
 * @param {Element} root - 消息根元素
 * @returns {string}
 */
export function extractCopyableText(root) {
  if (!root) return '';
  const parts = [];
  const content = root.querySelector('.chat-content, .chat-markdown, .chat-text') || root;

  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    if (el.matches('pre.md-code')) {
      const code = el.querySelector('code');
      parts.push('\n', getCodeText(code), '\n');
      return;
    }
    if (el.matches('pre.example-block, .chat-tool-block-code')) {
      parts.push('\n', el.textContent, '\n');
      return;
    }
    if (el.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    Array.from(el.childNodes).forEach(walk);
  };

  walk(content);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// 导出单例
export const markdownRenderer = new MarkdownRenderer();

// 导出便捷函数
export const {
  initMermaid,
  renderMermaidIn,
  bindMermaidToolbar,
  bindCodeBlockToolbar,
  render: renderMarkdown,
  syntaxHighlight,
  renderExampleBlock
} = markdownRenderer;
