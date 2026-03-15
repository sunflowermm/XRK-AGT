/**
 * 文件管理模块
 * 提供文件处理、ObjectURL 管理等功能
 */

/**
 * 文件管理器类
 */
export class FileManager {
  constructor() {
    this._objectUrls = new Set();
  }

  /**
   * 从 DataTransfer 提取文件
   * @param {DataTransfer} dt - DataTransfer 对象
   * @returns {Array<File>} 文件数组
   */
  extractFilesFromDataTransfer(dt) {
    const out = [];
    if (!dt) return out;

    const items = dt.items;
    if (items && items.length) {
      for (const it of items) {
        if (it && it.kind === 'file') {
          const f = it.getAsFile();
          if (f) out.push(f);
        }
      }
    }

    if (!out.length && dt.files && dt.files.length) {
      for (const f of dt.files) {
        out.push(f);
      }
    }

    return out;
  }

  /**
   * 创建被跟踪的 ObjectURL
   * @param {Blob|File} file - 文件或 Blob
   * @returns {string} ObjectURL
   */
  createTrackedObjectURL(file) {
    if (!file) return '';
    const url = URL.createObjectURL(file);
    this._objectUrls.add(url);
    return url;
  }

  /**
   * 安全地撤销 ObjectURL
   * @param {string} url - ObjectURL
   */
  safeRevokeObjectURL(url) {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
      this._objectUrls.delete(url);
    } catch (e) {
      console.warn('撤销 ObjectURL 失败:', e);
    }
  }

  /**
   * 撤销所有 ObjectURL
   */
  revokeAllObjectUrls() {
    if (!this._objectUrls) return;
    try {
      for (const url of this._objectUrls) {
        URL.revokeObjectURL(url);
      }
      this._objectUrls.clear();
    } catch (e) {
      console.warn('批量撤销 ObjectURL 失败:', e);
    }
  }

  /**
   * 读取文件为 Base64
   * @param {File} file - 文件
   * @returns {Promise<string>} Base64 字符串
   */
  readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * 读取文件为文本
   * @param {File} file - 文件
   * @param {string} encoding - 编码
   * @returns {Promise<string>} 文本内容
   */
  readAsText(file, encoding = 'UTF-8') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file, encoding);
    });
  }

  /**
   * 读取文件为 ArrayBuffer
   * @param {File} file - 文件
   * @returns {Promise<ArrayBuffer>} ArrayBuffer
   */
  readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 压缩图片文件
   * @param {File} file - 图片文件
   * @param {Object} options - 压缩选项
   * @returns {Promise<File>} 压缩后的文件
   */
  async compressImage(file, options = {}) {
    const {
      maxDimension = 1280,
      quality = 0.82,
      softLimit = 900 * 1024, // ~900KB
      outputType = 'image/jpeg'
    } = options;

    try {
      if (!file || !file.type?.startsWith('image/')) return file;

      // 小图直接返回原图
      if (file.size <= softLimit) return file;

      const url = URL.createObjectURL(file);

      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });

      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        URL.revokeObjectURL(url);
        return file;
      }

      const scale = Math.min(1, maxDimension / Math.max(w, h));
      const targetW = Math.max(1, Math.round(w * scale));
      const targetH = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        URL.revokeObjectURL(url);
        return file;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), outputType, quality);
      });

      URL.revokeObjectURL(url);
      if (!blob) return file;

      // 如果压缩后反而更大，就用原图
      if (blob.size >= file.size) return file;

      const name = (file.name || 'image').replace(/\.(png|jpg|jpeg|webp|bmp)$/i, '');
      const ext = outputType === 'image/jpeg' ? 'jpg' : outputType.split('/')[1];
      return new File([blob], `${name}.${ext}`, { type: outputType });
    } catch (e) {
      console.error('压缩图片失败:', e);
      return file;
    }
  }

  /**
   * 下载文件
   * @param {Blob|string} data - 文件数据或 URL
   * @param {string} filename - 文件名
   */
  download(data, filename) {
    const url = typeof data === 'string' ? data : URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (typeof data !== 'string') {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  /**
   * 验证文件类型
   * @param {File} file - 文件
   * @param {Array<string>} allowedTypes - 允许的 MIME 类型
   * @returns {boolean} 是否有效
   */
  validateFileType(file, allowedTypes) {
    if (!file || !allowedTypes || !allowedTypes.length) return true;
    return allowedTypes.some(type => {
      if (type.endsWith('/*')) {
        const prefix = type.slice(0, -2);
        return file.type.startsWith(prefix);
      }
      return file.type === type;
    });
  }

  /**
   * 验证文件大小
   * @param {File} file - 文件
   * @param {number} maxSize - 最大大小（字节）
   * @returns {boolean} 是否有效
   */
  validateFileSize(file, maxSize) {
    if (!file || !maxSize) return true;
    return file.size <= maxSize;
  }

  /**
   * 获取文件扩展名
   * @param {string} filename - 文件名
   * @returns {string} 扩展名（小写，不含点）
   */
  getFileExtension(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  /**
   * 获取文件图标
   * @param {File|string} fileOrType - 文件对象或 MIME 类型
   * @returns {string} 图标 emoji
   */
  getFileIcon(fileOrType) {
    const type = typeof fileOrType === 'string' ? fileOrType : fileOrType?.type || '';

    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type.startsWith('audio/')) return '🎵';
    if (type.startsWith('text/')) return '📄';
    if (type.includes('pdf')) return '📕';
    if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return '📦';
    if (type.includes('word') || type.includes('document')) return '📘';
    if (type.includes('excel') || type.includes('spreadsheet')) return '📗';
    if (type.includes('powerpoint') || type.includes('presentation')) return '📙';

    return '📄';
  }
}

// 导出单例
export const fileManager = new FileManager();

// 导出便捷函数
export const {
  extractFilesFromDataTransfer,
  createTrackedObjectURL,
  safeRevokeObjectURL,
  revokeAllObjectUrls,
  readAsBase64,
  readAsText,
  readAsArrayBuffer,
  compressImage,
  download,
  validateFileType,
  validateFileSize,
  getFileExtension,
  getFileIcon
} = fileManager;
