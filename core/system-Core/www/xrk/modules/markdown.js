/**
 * Markdown 渲染模块
 * 提供 Markdown 到 HTML 的转换和语法高亮功能
 */

import { escapeHtml } from './utils.js';

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
    try {
      if (!container || !window.mermaid) return;
      const nodes = container.querySelectorAll('pre code.language-mermaid');
      if (!nodes.length) return;

      const targets = Array.from(nodes).filter(node => !node.dataset.processed);
      if (!targets.length) return;

      for (const node of targets) {
        const code = node.textContent;
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await window.mermaid.render(id, code);
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-wrapper';
        wrapper.innerHTML = svg;
        node.parentElement.replaceWith(wrapper);
        node.dataset.processed = 'true';
      }

      this.bindMermaidToolbar(container);
    } catch (e) {
      console.warn('Mermaid 渲染失败:', e);
    }
  }

  /**
   * 绑定 Mermaid 工具栏
   * @param {Element} root - 根元素
   */
  bindMermaidToolbar(root) {
    if (!root) return;
    const wrappers = root.querySelectorAll('.mermaid-wrapper');
    if (!wrappers.length) return;

    wrappers.forEach(wrap => {
      if (wrap.dataset._toolbarBound) return;
      wrap.dataset._toolbarBound = 'true';

      const toolbar = document.createElement('div');
      toolbar.className = 'mermaid-toolbar';
      const copyIcon = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
      const checkIcon = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5"></path>
        </svg>
      `;
      const downloadIcon = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      `;
      toolbar.innerHTML = `
        <button class="mermaid-copy" type="button" title="复制" aria-label="复制 SVG">
          ${copyIcon}
        </button>
        <button class="mermaid-download" type="button" title="下载" aria-label="下载 SVG">
          ${downloadIcon}
        </button>
      `;
      wrap.appendChild(toolbar);

      const copyBtn = toolbar.querySelector('.mermaid-copy');
      const downloadBtn = toolbar.querySelector('.mermaid-download');

      if (copyBtn && navigator.clipboard) {
        copyBtn.addEventListener('click', async () => {
          const svg = wrap.querySelector('svg');
          if (svg) {
            try {
              const original = copyBtn.innerHTML;
              await navigator.clipboard.writeText(svg.outerHTML);
              copyBtn.innerHTML = checkIcon;
              setTimeout(() => {
                copyBtn.innerHTML = original;
              }, 2000);
            } catch (e) {
              console.error('复制失败:', e);
            }
          }
        });
      }

      if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
          const svg = wrap.querySelector('svg');
          if (svg) {
            const xml = new XMLSerializer().serializeToString(svg);
            const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mermaid-${Date.now()}.svg`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
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

    // 保护代码块
    const codeBlocks = [];
    const withPlaceholders = String(text).replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const id = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push({ lang: lang || '', code });
      return id;
    });

    // 保护行内代码
    const inlineCodes = [];
    const withInlineProtected = withPlaceholders.replace(/`([^`]+)`/g, (_, code) => {
      const id = `__INLINE_CODE_${inlineCodes.length}__`;
      inlineCodes.push(code);
      return id;
    });

    // 处理块级元素
    let html = withInlineProtected;

    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 列表
    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');

    // 包装列表
    html = html.replace(/(<li>.*<\/li>\n?)+/g, match => {
      return `<ul>${match}</ul>`;
    });

    // 引用
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // 水平线
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\*\*\*$/gm, '<hr>');

    // 行内样式
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 图片
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

    // 恢复行内代码
    inlineCodes.forEach((code, i) => {
      html = html.replace(`__INLINE_CODE_${i}__`, `<code>${escapeHtml(code)}</code>`);
    });

    // 恢复代码块
    codeBlocks.forEach((block, i) => {
      const langAttr = block.lang ? ` data-lang="${escapeHtml(block.lang)}"` : '';
      const highlighted = this.syntaxHighlight(block.code, block.lang);
      html = html.replace(
        `__CODE_BLOCK_${i}__`,
        `<pre><code class="language-${escapeHtml(block.lang)}"${langAttr}>${highlighted}</code></pre>`
      );
    });

    // 段落
    html = html.replace(/\n\n/g, '</p><p>');
    html = `<p>${html}</p>`;

    // 清理空段落
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<[huo])/g, '$1');
    html = html.replace(/(<\/[huo][^>]*>)<\/p>/g, '$1');

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

// 导出单例
export const markdownRenderer = new MarkdownRenderer();

// 导出便捷函数
export const {
  initMermaid,
  renderMermaidIn,
  bindMermaidToolbar,
  render: renderMarkdown,
  syntaxHighlight,
  renderExampleBlock
} = markdownRenderer;
