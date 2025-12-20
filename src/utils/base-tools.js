import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);
const IS_WINDOWS = process.platform === 'win32';

/**
 * 统一基础工具系统
 * 提供文件操作、文本处理等核心功能，类似Cursor的工具集
 */
export class BaseTools {
  constructor(workspace = null) {
    this.workspace = workspace || (IS_WINDOWS 
      ? path.join(os.homedir(), 'Desktop')
      : path.join(os.homedir(), 'Desktop'));
    this.processRegistry = new Set(); // 进程注册表
  }

  /**
   * 读取文件
   */
  async readFile(filePath, encoding = 'utf8') {
    const fullPath = this.resolvePath(filePath);
    try {
      const content = await fs.readFile(fullPath, encoding);
      return { success: true, content, path: fullPath };
    } catch (error) {
      return { success: false, error: error.message, path: fullPath };
    }
  }

  /**
   * 写入文件
   */
  async writeFile(filePath, content, encoding = 'utf8') {
    const fullPath = this.resolvePath(filePath);
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, encoding);
      return { success: true, path: fullPath };
    } catch (error) {
      return { success: false, error: error.message, path: fullPath };
    }
  }

  /**
   * 搜索文件（在工作区递归搜索）
   */
  async searchFiles(pattern, options = {}) {
    const {
      maxDepth = 3,
      fileExtensions = null,
      caseSensitive = false
    } = options;

    const results = [];
    const searchPattern = caseSensitive 
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const searchDir = async (dir, depth = 0) => {
      if (depth > maxDepth) return;
      
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            await searchDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (fileExtensions && !fileExtensions.includes(ext)) continue;
            if (searchPattern.test(entry.name) || searchPattern.test(fullPath)) {
              results.push(fullPath);
            }
          }
        }
      } catch (error) {
        // 忽略权限错误等
      }
    };

    await searchDir(this.workspace);
    return results;
  }

  /**
   * Grep搜索（在文件中搜索文本）
   */
  async grep(pattern, filePath = null, options = {}) {
    const {
      caseSensitive = false,
      lineNumbers = true,
      maxResults = 100
    } = options;

    const searchPattern = caseSensitive 
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const searchInFile = async (file) => {
      try {
        const content = await fs.readFile(file, 'utf8');
        const lines = content.split('\n');
        const matches = [];

        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          if (searchPattern.test(lines[i])) {
            matches.push({
              file,
              line: i + 1,
              content: lines[i].trim()
            });
          }
        }

        return matches;
      } catch (error) {
        return [];
      }
    };

    if (filePath) {
      const fullPath = this.resolvePath(filePath);
      const matches = await searchInFile(fullPath);
      return { success: true, matches };
    } else {
      // 在工作区搜索所有文本文件
      const textFiles = await this.searchFiles('', {
        fileExtensions: ['.txt', '.md', '.js', '.json', '.py', '.java', '.cpp', '.c', '.h']
      });
      
      const allMatches = [];
      for (const file of textFiles) {
        const matches = await searchInFile(file);
        allMatches.push(...matches);
        if (allMatches.length >= maxResults) break;
      }

      return { success: true, matches: allMatches.slice(0, maxResults) };
    }
  }

  /**
   * 列出目录内容
   */
  async listDir(dirPath = null, options = {}) {
    const { includeHidden = false, type = 'all' } = options;
    const targetDir = dirPath ? this.resolvePath(dirPath) : this.workspace;

    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const items = [];

      for (const entry of entries) {
        if (!includeHidden && entry.name.startsWith('.')) continue;

        const fullPath = path.join(targetDir, entry.name);
        const stats = await fs.stat(fullPath);

        if (type === 'files' && !stats.isFile()) continue;
        if (type === 'dirs' && !stats.isDirectory()) continue;

        items.push({
          name: entry.name,
          path: fullPath,
          type: stats.isDirectory() ? 'directory' : 'file',
          size: stats.isFile() ? stats.size : null,
          modified: stats.mtime
        });
      }

      return { success: true, items, path: targetDir };
    } catch (error) {
      return { success: false, error: error.message, path: targetDir };
    }
  }

  /**
   * 解析路径（相对路径转为绝对路径）
   */
  resolvePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.workspace, filePath);
  }

  /**
   * 执行命令（注册进程以便后续清理）
   */
  async executeCommand(command, options = {}) {
    const {
      cwd = this.workspace,
      timeout = 30000,
      registerProcess = true
    } = options;

    try {
      const result = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024
      });
      
      return {
        success: true,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stderr: error.stderr || '',
        stdout: error.stdout || ''
      };
    }
  }

  /**
   * 获取已注册的进程列表
   */
  getRegisteredProcesses() {
    return Array.from(this.processRegistry);
  }

  /**
   * 清理已注册的进程
   */
  async cleanupProcesses() {
    if (!IS_WINDOWS) return { success: true, killed: [] };

    const killed = [];
    for (const pid of this.processRegistry) {
      try {
        await execAsync(`taskkill /F /PID ${pid}`, { timeout: 5000 });
        killed.push(pid);
        this.processRegistry.delete(pid);
      } catch (error) {
        // 进程可能已结束
        this.processRegistry.delete(pid);
      }
    }

    return { success: true, killed };
  }

  /**
   * 监控并清理无用进程（自动检测）
   */
  async autoCleanupProcesses(excludePatterns = []) {
    if (!IS_WINDOWS) return { success: true, killed: [] };

    try {
      const { stdout } = await execAsync('tasklist /FO CSV /NH', { encoding: 'utf8' });
      const lines = stdout.split('\n').filter(line => line.trim());
      
      const processes = lines.map(line => {
        const parts = line.match(/"([^"]+)"/g);
        if (!parts || parts.length < 2) return null;
        return {
          name: parts[0].replace(/"/g, ''),
          pid: parseInt(parts[1].replace(/"/g, ''))
        };
      }).filter(Boolean);

      // 检测无用进程（可根据需要扩展逻辑）
      const killed = [];
      for (const proc of processes) {
        // 排除系统进程和重要应用
        if (excludePatterns.some(p => p.test(proc.name))) continue;
        if (proc.name.includes('System') || proc.name.includes('explorer')) continue;

        // 可以添加更多判断逻辑，比如检测长时间无活动的进程
        // 这里简化处理，只清理明确注册的进程
      }

      return { success: true, killed };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

