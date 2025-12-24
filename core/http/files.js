import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { ulid } from 'ulid';
import crypto from 'crypto';
import paths from '../../src/utils/paths.js';
import BotUtil from '../../src/utils/botutil.js';

const uploadDir = path.join(paths.data, 'uploads');
const mediaDir = path.join(paths.data, 'media');
const fileMap = new Map();

// 确保目录存在（防御性编程，模块加载时可能早于 ensureBaseDirs 调用）
for (const dir of [uploadDir, mediaDir]) {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 解析multipart/form-data
 */
async function parseMultipartData(req) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers['content-type'].split('boundary=')[1];
    if (!boundary) {
      reject(new Error('No boundary found'));
      return;
    }

    let data = Buffer.alloc(0);
    const files = [];

    req.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
    });

    req.on('end', () => {
      const parts = data.toString('binary').split(`--${boundary}`);
      
      for (const part of parts) {
        if (part.includes('Content-Disposition: form-data')) {
          const nameMatch = part.match(/name="([^"]+)"/);
          const filenameMatch = part.match(/filename="([^"]+)"/);
          
          if (filenameMatch) {
            const filename = filenameMatch[1];
            const contentTypeMatch = part.match(/Content-Type: ([^\r\n]+)/);
            const contentType = contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream';
            
            const headerEndIndex = part.indexOf('\r\n\r\n');
            if (headerEndIndex !== -1) {
              const fileStart = headerEndIndex + 4;
              const fileEnd = part.lastIndexOf('\r\n');
              const fileContent = Buffer.from(part.substring(fileStart, fileEnd), 'binary');
              
              files.push({
                fieldname: nameMatch ? nameMatch[1] : 'file',
                originalname: filename,
                mimetype: contentType,
                buffer: fileContent,
                size: fileContent.length
              });
            }
          }
        }
      }
      
      resolve({ files });
    });

    req.on('error', reject);
  });
}

/**
 * 文件管理API
 * 提供文件上传、下载、预览等功能
 */
export default {
  name: 'file',
  dsc: '文件管理API',
  priority: 95,

  routes: [
    {
      method: 'POST',
      path: '/api/file/upload',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ 
            success: false, 
            message: 'Unauthorized',
            code: 403
          });
        }

        try {
          const contentType = req.headers['content-type'] || '';
          let files = [];
          
          if (contentType.includes('multipart/form-data')) {
            const result = await parseMultipartData(req);
            files = result.files;
          } else {
            return res.status(400).json({ 
              success: false, 
              message: '请使用 multipart/form-data 格式上传文件',
              code: 400
            });
          }

          if (files.length === 0) {
            return res.status(400).json({ 
              success: false, 
              message: '没有文件',
              code: 400
            });
          }

          const uploadedFiles = [];

          for (const file of files) {
            const fileId = ulid();
            const ext = path.extname(file.originalname) || '.file';
            const filename = `${fileId}${ext}`;
            
            const isMedia = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav|ogg)$/i.test(ext);
            const targetDir = isMedia ? mediaDir : uploadDir;
            const targetPath = path.join(targetDir, filename);
            
            await fs.writeFile(targetPath, file.buffer);
            
            const hash = crypto.createHash('md5').update(file.buffer).digest('hex');
            
            const fileInfo = {
              id: fileId,
              name: file.originalname,
              path: targetPath,
              url: `${Bot.url}/${isMedia ? 'media' : 'uploads'}/${filename}`,
              download_url: `${Bot.url}/api/file/${fileId}?download=true`,
              preview_url: isMedia ? `${Bot.url}/api/file/${fileId}` : null,
              size: file.size,
              mime: file.mimetype,
              hash: hash,
              is_media: isMedia,
              upload_time: Date.now()
            };

            fileMap.set(fileId, fileInfo);
            uploadedFiles.push(fileInfo);
          }

          const results = uploadedFiles.map(fileInfo => ({
            type: fileInfo.is_media ? 'image' : 'file',
            data: [{
              type: fileInfo.is_media ? 'image' : 'file',
              url: fileInfo.url,
              name: fileInfo.name,
              size: fileInfo.size,
              mime: fileInfo.mime,
              download_url: fileInfo.download_url,
              preview_url: fileInfo.preview_url
            }]
          }));

          if (files.length === 1) {
            const fileInfo = uploadedFiles[0];
            res.json({
              success: true,
              code: 200,
              file_id: fileInfo.id,
              file_url: fileInfo.url,
              file_name: fileInfo.name,
              results: results,
              timestamp: Date.now()
            });
          } else {
            res.json({
              success: true,
              code: 200,
              files: uploadedFiles.map(f => ({
                file_id: f.id,
                file_url: f.url,
                file_name: f.name
              })),
              results: results,
              timestamp: Date.now()
            });
          }
        } catch (error) {
          BotUtil.makeLog('error', `文件上传处理失败: ${error.message}`, 'FileAPI');
          res.status(500).json({ 
            success: false, 
            message: '文件上传失败',
            error: error.message,
            code: 500
          });
        }
      }
    },

    {
      method: 'GET',
      path: '/api/file/:id',
      handler: async (req, res, Bot) => {
        const { id } = req.params;
        const { download } = req.query;
        const fileInfo = fileMap.get(id);

        if (!fileInfo) {
          try {
            for (const dir of [uploadDir, mediaDir]) {
              const files = await fs.readdir(dir);
              const file = files.find(f => f.includes(id));
              if (file) {
                const filePath = path.join(dir, file);
                if (download === 'true') {
                  return res.download(filePath, file);
                }
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                return res.sendFile(filePath);
              }
            }
          } catch (err) {
            BotUtil.makeLog('error', `查找文件失败: ${err.message}`, 'FileAPI');
          }
          
          return res.status(404).json({ 
            success: false, 
            message: '文件不存在',
            code: 404
          });
        }

        try {
          await fs.access(fileInfo.path);
          
          if (download === 'true') {
            res.download(fileInfo.path, fileInfo.name);
          } else {
            res.setHeader('Content-Type', fileInfo.mime);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.sendFile(fileInfo.path);
          }
        } catch {
          fileMap.delete(id);
          res.status(404).json({ 
            success: false, 
            message: '文件不存在',
            code: 404
          });
        }
      }
    },

    {
      method: 'DELETE',
      path: '/api/file/:id',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ 
            success: false, 
            message: 'Unauthorized',
            code: 403
          });
        }

        const { id } = req.params;
        const fileInfo = fileMap.get(id);

        if (fileInfo) {
          try {
            await fs.unlink(fileInfo.path);
            fileMap.delete(id);
          } catch (err) {
            BotUtil.makeLog('error', `删除文件失败: ${err.message}`, 'FileAPI');
          }
        }

        res.json({ 
          success: true, 
          message: '文件已删除',
          code: 200,
          timestamp: Date.now()
        });
      }
    },

    {
      method: 'GET',
      path: '/api/files',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ 
            success: false, 
            message: 'Unauthorized',
            code: 403
          });
        }

        const files = Array.from(fileMap.values()).map(f => ({
          id: f.id,
          name: f.name,
          url: f.url,
          size: f.size,
          mime: f.mime,
          is_media: f.is_media,
          upload_time: f.upload_time
        }));

        res.json({ 
          success: true, 
          files,
          total: files.length,
          timestamp: Date.now()
        });
      }
    }
  ],

  init(app, Bot) {
    // 定期清理过期文件
    setInterval(async () => {
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24小时
      
      for (const [id, info] of fileMap) {
        if (now - info.upload_time > maxAge) {
          try {
            await fs.unlink(info.path);
            fileMap.delete(id);
            BotUtil.makeLog('debug', `清理过期文件: ${info.name}`, 'FileAPI');
          } catch {}
        }
      }
    }, 60 * 60 * 1000);
  }
};