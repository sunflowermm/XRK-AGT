/**
 * Markdown + Mermaid（对齐原 markdown.js；mermaid 与 chart.js 同为正式依赖）
 */
import { marked } from 'marked';
import mermaid from 'mermaid';

marked.setOptions({
  gfm: true,
  breaks: true,
});

let mermaidInited = false;

function ensureMermaid() {
  if (mermaidInited) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'neutral',
  });
  mermaidInited = true;
}

export function renderMarkdown(text) {
  try {
    return marked.parse(String(text || ''), { async: false });
  } catch {
    return escapeHtml(String(text || ''));
  }
}

export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 在容器内渲染 ```mermaid 代码块 */
export async function renderMermaidIn(root) {
  if (!root) return;
  const blocks = root.querySelectorAll('pre code.language-mermaid, code.language-mermaid');
  if (!blocks.length) return;
  ensureMermaid();
  let i = 0;
  for (const code of blocks) {
    const pre = code.closest('pre') || code.parentElement;
    if (!pre || pre.dataset.mermaidDone === '1') continue;
    const src = code.textContent || '';
    if (!src.trim()) continue;
    const id = `mmd_${Date.now()}_${i++}`;
    try {
      const { svg } = await mermaid.render(id, src);
      const wrap = document.createElement('div');
      wrap.className = 'chat-mermaid';
      wrap.innerHTML = svg;
      pre.replaceWith(wrap);
      pre.dataset.mermaidDone = '1';
    } catch (err) {
      const errEl = document.createElement('div');
      errEl.className = 'chat-mermaid-error';
      errEl.textContent = `Mermaid 渲染失败: ${err?.message || err}`;
      pre.after(errEl);
      pre.dataset.mermaidDone = '1';
    }
  }
}

export async function downloadImage(url) {
  if (!url) throw new Error('无图片地址');
  const name = `image-${Date.now()}.png`;
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    const a = document.createElement('a');
    a.download = name;
    a.href = url;
    a.click();
    return;
  }
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(res.statusText || '下载失败');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = name;
  a.href = href;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
