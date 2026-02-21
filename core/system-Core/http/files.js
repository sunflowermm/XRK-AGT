import path from 'path';
import fs from 'fs/promises';
import { ulid } from 'ulid';
import crypto from 'crypto';
import paths from '#utils/paths.js';
import BotUtil from '#utils/botutil.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';
import { InputValidator } from '#utils/input-validator.js';
import { HttpResponse } from '#utils/http-utils.js';
import { parseMultipartData } from '#utils/multipart-parser.js';

const uploadDir = path.join(paths.data, 'uploads');
const mediaDir = path.join(paths.data, 'media');
const fileMap = new Map();

// 目录已在 paths.ensureBaseDirs() 中创建，无需重复创建

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
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) return HttpResponse.validationError(res, '请使用 multipart/form-data 格式上传文件');
        const { files } = await parseMultipartData(req);
        if (!files?.length) return HttpResponse.validationError(res, '没有文件');

        const uploadedFiles = [];
        for (const file of files) {
          const fileId = ulid();
          const ext = path.extname(file.originalname) || '.file';
          const filename = `${fileId}${ext}`;
          const isMedia = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav|ogg)$/i.test(ext);
          const targetDir = isMedia ? mediaDir : uploadDir;
          const safeFilename = InputValidator.validatePath(filename, targetDir);
          const targetPath = path.join(targetDir, safeFilename);
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
            hash,
            is_media: isMedia,
            upload_time: Date.now()
          };
          fileMap.set(fileId, fileInfo);
          uploadedFiles.push(fileInfo);
        }

        const results = uploadedFiles.map(f => ({
          type: f.is_media ? 'image' : 'file',
          data: [{ type: f.is_media ? 'image' : 'file', url: f.url, name: f.name, size: f.size, mime: f.mime, download_url: f.download_url, preview_url: f.preview_url }]
        }));
        const payload = {
          files: uploadedFiles.map(f => ({ file_id: f.id, file_url: f.url, file_name: f.name })),
          results,
          timestamp: Date.now()
        };
        if (uploadedFiles.length === 1) Object.assign(payload, { file_id: uploadedFiles[0].id, file_url: uploadedFiles[0].url, file_name: uploadedFiles[0].name });
        HttpResponse.success(res, payload);
      }, 'file.upload')
    },

    {
      method: 'GET',
      path: '/api/file/:id',
      handler: HttpResponse.asyncHandler(async (req, res) => {
        // 输入验证
        const { id } = req.params;
        if (!id || typeof id !== 'string' || id.length > 50) {
          return HttpResponse.validationError(res, '无效的文件ID');
        }
        
        const { download } = req.query;
        const fileInfo = fileMap.get(id);

        if (!fileInfo) {
          try {
            for (const dir of [uploadDir, mediaDir]) {
              const files = await fs.readdir(dir);
              const file = files.find(f => f.includes(id));
              if (file) {
                // 路径验证
                const safeFile = InputValidator.validatePath(file, dir);
                const filePath = path.join(dir, safeFile);
                
                if (download === 'true') {
                  return res.download(filePath, file);
                }
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                return res.sendFile(filePath);
              }
            }
          } catch (err) {
            // debug: 文件查找失败是技术细节
            BotUtil.makeLog('debug', `查找文件失败: ${err.message}`, 'FileAPI');
          }
          
          return HttpResponse.notFound(res, '文件不存在');
        }

        InputValidator.validatePath(fileInfo.path, fileInfo.is_media ? mediaDir : uploadDir);
        await fs.access(fileInfo.path);
        if (download === 'true') res.download(fileInfo.path, fileInfo.name);
        else {
          res.setHeader('Content-Type', fileInfo.mime);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.sendFile(fileInfo.path);
        }
      }, 'file.get')
    },

    {
      method: 'DELETE',
      path: '/api/file/:id',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { id } = req.params;
        if (!id || typeof id !== 'string' || id.length > 50) {
          return HttpResponse.validationError(res, '无效的文件ID');
        }
        
        const fileInfo = fileMap.get(id);

        if (fileInfo) {
          try {
            // 路径验证
            InputValidator.validatePath(fileInfo.path, fileInfo.is_media ? mediaDir : uploadDir);
            await fs.unlink(fileInfo.path);
            fileMap.delete(id);
          } catch (err) {
            errorHandler.handle(
              err,
              { context: 'file.delete', fileId: id, code: ErrorCodes.SYSTEM_ERROR }
            );
            BotUtil.makeLog('error', `删除文件失败: ${err.message}`, 'FileAPI');
          }
        }

        HttpResponse.success(res, null, '文件已删除');
      }, 'file.delete')
    },

    {
      method: 'GET',
      path: '/api/files',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const files = Array.from(fileMap.values()).map(f => ({
          id: f.id,
          name: f.name,
          url: f.url,
          size: f.size,
          mime: f.mime,
          is_media: f.is_media,
          upload_time: f.upload_time
        }));

        HttpResponse.success(res, {
          files,
          total: files.length,
          timestamp: Date.now()
        });
      }, 'file.list')
    }
  ],

  init() {
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