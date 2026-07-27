/**
 * MCP 工具块辅助（对齐原 _parseToolResultPayload / _buildToolResultPreview / _summarizeToolResultText）
 */
import { deepClone } from '@/utils/http.js';

export function parseToolResultPayload(result) {
  if (result == null || result === '') return null;
  if (typeof result === 'object') return result;
  if (typeof result !== 'string') return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

export function toolArgsText(tool) {
  const args = tool?.arguments ?? tool?.function?.arguments ?? {};
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function toolName(tool) {
  return tool?.name || tool?.function?.name || '工具';
}

export function toolResultPreview(name, payload) {
  const data = payload?.data ?? payload;
  const mime = data?.mimeType || data?.mime;
  const b64 = data?.base64;
  if (typeof b64 === 'string' && b64.length > 40 && String(mime || '').startsWith('image/')) {
    return {
      type: 'image',
      src: `data:${mime || 'image/png'};base64,${b64}`,
      alt: `${name} 截图`,
    };
  }
  return null;
}

export function summarizeToolResultText(payload) {
  if (payload == null || payload === '') return '';
  const clone = typeof payload === 'object' ? deepClone(payload) : parseToolResultPayload(payload);
  if (clone && typeof clone === 'object') {
    const data = clone.data ?? clone;
    if (data?.base64 && String(data.base64).length > 200) {
      data.base64 = `[base64 ${String(data.base64).length} chars]`;
    }
    try {
      const s = JSON.stringify(clone, null, 2);
      return s.length > 8000 ? `${s.slice(0, 8000)}\n…` : s;
    } catch {
      return String(payload);
    }
  }
  const s = String(payload);
  return s.length > 8000 ? `${s.slice(0, 8000)}\n…` : s;
}

/** 工具是否可能改动工作区文件（用于刷目录） */
export function toolsMayTouchWorkspace(tools) {
  if (!Array.isArray(tools) || !tools.length) return false;
  const touch = /^(write|delete_file|modify_file|run|bash|shell)/i;
  return tools.some((t) => {
    const name = String(toolName(t)).split('.').pop() || '';
    return touch.test(name);
  });
}
