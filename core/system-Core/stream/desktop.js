import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { BaseTools } from '#utils/base-tools.js';
import si from 'systeminformation';
import fetch from 'node-fetch';
import StreamLoader from '#infrastructure/aistream/loader.js';

const IS_WINDOWS = process.platform === 'win32';
const execAsync = promisify(exec);

const execCommand = (command, options = {}, needOutput = false) => {
  return new Promise((resolve, reject) => {
    exec(command, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        return reject(error);
      }
      resolve(stdout || '');
    });
  });
};

/**
 * 桌面与通用助手工作流
 * 
 * 功能分类：
 * - MCP工具（返回JSON）：
 *   - 信息读取：screenshot（截屏）、system_info（系统信息）、disk_space（磁盘空间）、list_desktop_files（列出桌面文件）
 *   - 文档生成：create_word_document（生成Word）、create_excel_document（生成Excel）
 *   - 数据查询：stock_quote（股票行情）
 * - Call Function（执行操作）：
 *   - 系统操作：show_desktop（回桌面）、open_system_tool（打开系统工具）、lock_screen（锁屏）、power_control（电源控制）
 *   - 文件操作：create_folder（创建文件夹）、open_explorer（打开资源管理器）、open_application（打开应用）
 *   - 网络操作：open_browser（打开浏览器）
 *   - 命令执行：execute_powershell（执行PowerShell）、cleanup_processes（清理进程）
 *   - 工作流：start_workflow（启动工作流）
 */
export default class DesktopStream extends AIStream {

  constructor() {
    super({
      name: 'desktop',
      description: '桌面与通用助手工作流',
      version: '2.0.0',
      author: 'XRK',
      priority: 100,
      config: {
        enabled: true,
        temperature: 0.8,
        maxTokens: 4000,
        topP: 0.9,
        presencePenalty: 0.6,
        frequencyPenalty: 0.6
      },
      embedding: { enabled: true }
    });

    // 工作区：桌面目录（desktop工作流的默认工作区）
    this.workspace = IS_WINDOWS
      ? path.join(os.homedir(), 'Desktop')
      : path.join(os.homedir(), 'Desktop');

    // 初始化统一工具系统
    this.tools = new BaseTools(this.workspace);
    this.processCleanupInterval = null;
  }

  /**
   * 获取工作区路径
   */
  getWorkspace() {
    return this.workspace;
  }

  async init() {
    await super.init();


    // 先注册自己的函数
    this.registerAllFunctions();

    // 合并 ToolsStream（提供 write/run/note 核心工具，read/grep已移至MCP工具）
    // 注意：从 StreamLoader 获取已存在的实例，避免重复初始化导致重复注册
    const toolsStream = StreamLoader.getStream('tools');
    if (toolsStream) {
      this.merge(toolsStream);
    }

    // 启动进程清理监控（每30秒检查一次）
    if (IS_WINDOWS) {
      this.processCleanupInterval = setInterval(async () => {
        try {
          await this.tools.autoCleanupProcesses([
            /explorer/i, /System/i, /winlogon/i, /csrss/i, /smss/i,
            /svchost/i, /dwm/i, /wininit/i
          ]);
        } catch (err) {
          // 静默处理清理错误
        }
      }, 30000);
    }

  }

  handleError(context, error, operation) {
    BotUtil.makeLog('error', `[desktop] ${operation}失败: ${error.message}`, 'DesktopStream');
    context.lastError = { operation, message: error.message };
  }

  requireWindows(context, operation) {
    if (IS_WINDOWS) return true;
    context.windowsOnly = true;
    return false;
  }

  /**
   * 统一参数获取：支持多种参数名（兼容MCP工具和内部调用）
   */
  getParam(params, ...keys) {
    if (!params) return undefined;
    for (const key of keys) {
      if (params[key] !== undefined && params[key] !== null) {
        return params[key];
      }
    }
    return undefined;
  }

  /**
   * 统一文件名安全处理
   */
  sanitizeFileName(fileName) {
    if (!fileName) return '';
    return fileName.replace(/[<>:"/\\|?*]/g, '_');
  }

  /**
   * 统一错误响应格式
   */
  errorResponse(code, message) {
    return {
      success: false,
      error: { code, message }
    };
  }

  /**
   * 统一成功响应格式
   */
  successResponse(data) {
    return {
      success: true,
      data: {
        ...data,
        timestamp: Date.now()
      }
    };
  }

  /**
   * 统一解析JSON数据（支持字符串和对象）
   */
  parseJsonData(data) {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (e) {
        throw new Error(`JSON数据解析失败: ${e.message}`);
      }
    }
    return data;
  }

  /**
   * 统一Excel数据格式转换：将各种格式转换为统一的sheets格式
   */
  normalizeExcelData(data) {
    // 格式1: sheets格式 { sheets: [{ name: "...", data: [[...], [...]] }] }
    if (typeof data === 'object' && !Array.isArray(data) && data.sheets && Array.isArray(data.sheets)) {
      return data.sheets;
    }
    // 格式2: 二维数组格式 [[header1, header2], [value1, value2], ...]
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      return [{ name: 'Sheet1', data }];
    }
    // 格式3: 对象数组格式 [{header1: value1, header2: value2}, ...]
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      const headers = Object.keys(data[0]);
      const rows = data.map(row => headers.map(header => row[header]));
      return [{ name: 'Sheet1', data: [headers, ...rows] }];
    }
    // 格式4: headers/rows格式 { headers: [...], rows: [[...], [...]] }
    if (typeof data === 'object' && !Array.isArray(data) && data.headers && data.rows) {
      return [{ name: 'Sheet1', data: [data.headers, ...data.rows] }];
    }
    // 格式5: 单个对象，转换为数组
    if (typeof data === 'object' && !Array.isArray(data)) {
      const headers = Object.keys(data);
      const values = headers.map(header => data[header]);
      return [{ name: 'Sheet1', data: [headers, values] }];
    }
    throw new Error('不支持的数据格式。支持格式：1) sheets格式 2) 二维数组 3) 对象数组 4) headers/rows格式');
  }

  /**
   * 注册所有功能
   * 
   * MCP工具：screenshot, system_info, disk_space, list_desktop_files, create_word_document, create_excel_document, stock_quote（返回JSON，不出现在prompt中）
   * Call Function：所有系统操作、文件操作、命令执行功能（出现在prompt中，供AI调用）
   */
  registerAllFunctions() {
    // Call Function：回到桌面（执行操作）
    this.registerFunction('show_desktop', {
      description: '回到桌面 - 最小化所有窗口显示桌面（仅限Windows系统）。适用场景：用户想要清空屏幕、查看桌面文件、需要干净的工作环境、或准备进行截屏等操作时使用。',
      prompt: `[回桌面] - 帮用户切换到桌面`,
      parser: (text, context) => {
        if (!text.includes('[回桌面]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'show_desktop', params: {} }],
          cleanText: text.replace(/\[回桌面\]/g, '').trim()
        };
      },
      handler: async (params = {}, context = {}) => {
        if (!this.requireWindows(context, '回桌面功能')) return;

        try {
          await execAsync('powershell -Command "(New-Object -ComObject shell.application).MinimizeAll()"', { timeout: 5000 });
        } catch (err) {
          this.handleError(context, err, '回桌面操作');
        }
      },
      enabled: true
    });

    // Call Function：打开系统工具（执行操作）
    this.registerFunction('open_system_tool', {
      description: '打开常用系统工具',
      prompt: `[打开记事本] [打开计算器] [任务管理器] - 在电脑上打开对应的系统工具`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const toolMap = {
          '[打开记事本]': { tool: 'notepad', name: '记事本' },
          '[打开计算器]': { tool: 'calc', name: '计算器' },
          '[任务管理器]': { tool: 'taskmgr', name: '任务管理器' }
        };

        for (const [pattern, { tool }] of Object.entries(toolMap)) {
          if (text.includes(pattern)) {
            functions.push({ type: 'open_system_tool', params: { tool } });
            cleanText = cleanText.replace(new RegExp(pattern.replace(/[\[\]]/g, '\\$&'), 'g'), '').trim();
          }
        }

        return { functions, cleanText };
      },
      handler: async (params = {}, context = {}) => {
        if (!this.requireWindows(context, '打开系统工具功能')) return;

        const { tool } = params;
        if (!tool) return;

        const toolNames = { notepad: '记事本', calc: '计算器', taskmgr: '任务管理器' };

        try {
          await execCommand(`start "" ${tool}`, { shell: 'cmd.exe' });
          context.executedTool = toolNames[tool] || '应用';
        } catch (err) {
          this.handleError(context, err, '打开系统工具');
        }
      },
      enabled: true
    });
    // MCP工具：截屏（返回JSON结果）
    this.registerMCPTool('screenshot', {
      description: '截取当前屏幕，返回截图文件路径和大小',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (args = {}, context = {}) => {
        try {
          const screenshot = (await import('screenshot-desktop')).default;

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const screenshotDir = path.join(paths.trash, 'screenshot');

          const filename = `screenshot_${timestamp}.png`;
          const screenshotPath = path.join(screenshotDir, filename);

          const img = await screenshot({ screen: -1 });
          await fs.writeFile(screenshotPath, img);

          const stats = await fs.stat(screenshotPath);
          if (stats.size === 0) {
            throw new Error('截屏文件为空');
          }

          // 存储到上下文
          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.screenshotPath = screenshotPath;
            context.stream.context.screenshotSize = stats.size;
          }

          BotUtil.makeLog('info', `截图成功: ${screenshotPath} (${stats.size} bytes)`, 'DesktopStream');
          
          return this.successResponse({
            filePath: screenshotPath,
            fileName: filename,
            size: stats.size
          });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 截屏失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('SCREENSHOT_FAILED', err.message);
        }
      },
      enabled: true
    });

    // Call Function：锁屏（执行操作）
    this.registerFunction('lock_screen', {
      description: '锁定电脑屏幕',
      prompt: `[锁屏] - 锁定电脑屏幕`,
      parser: (text, context) => {
        if (!text.includes('[锁屏]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'lock_screen', params: {} }],
          cleanText: text.replace(/\[锁屏\]/g, '').trim()
        };
      },
      handler: async (params = {}, context = {}) => {
        if (!this.requireWindows(context, '锁屏功能')) return;

        try {
          await execCommand('rundll32.exe user32.dll,LockWorkStation');
        } catch (err) {
          this.handleError(context, err, '锁屏操作');
        }
      },
      enabled: true
    });

    // MCP工具：查看系统信息（返回JSON结果）
    this.registerMCPTool('system_info', {
      description: '查看电脑的 CPU、内存使用情况',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (args = {}, context = {}) => {
        try {
          // 使用systeminformation库获取系统信息（跨平台）
          const [cpu, mem] = await Promise.all([
            si.currentLoad(),
            si.mem()
          ]);

          const cpuUsage = cpu.currentLoad ? cpu.currentLoad.toFixed(1) : '0.0';
          const memTotal = mem.total / 1024 / 1024 / 1024; // GB
          const memFree = mem.free / 1024 / 1024 / 1024; // GB
          const memUsed = mem.used / 1024 / 1024 / 1024; // GB
          const memUsedPercent = ((memUsed / memTotal) * 100).toFixed(1);

          const systemInfo = {
            cpu: `${cpuUsage}%`,
            memory: {
              usedPercent: `${memUsedPercent}%`,
              freeGB: `${memFree.toFixed(2)}GB`,
              totalGB: `${memTotal.toFixed(2)}GB`,
              usedGB: `${memUsed.toFixed(2)}GB`
            }
          };

          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.systemInfo = systemInfo;
          }

          return this.successResponse(systemInfo);
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 获取系统信息失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('SYSTEM_INFO_FAILED', err.message);
        }
      },
      enabled: true
    });

    // Call Function：打开浏览器（执行操作）
    this.registerFunction('open_browser', {
      description: '打开浏览器访问网页',
      prompt: `[打开网页:url] - 在浏览器中打开指定网页，例如：[打开网页:https://www.baidu.com]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[打开网页:([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const url = (match[1] || '').trim();
          if (url) {
            functions.push({ type: 'open_browser', params: { url } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params = {}, context = {}) => {
        const url = this.getParam(params, 'url');
        if (!url) return;

        const commands = {
          win32: `start "" "${url}"`,
          darwin: `open "${url}"`,
          linux: `xdg-open "${url}"`
        };

        try {
          const command = commands[process.platform] || commands.linux;
          await execCommand(command, { shell: IS_WINDOWS ? 'cmd.exe' : undefined });
          context.openedUrl = url;
        } catch (err) {
          this.handleError(context, err, '打开网页');
        }
      },
      enabled: true
    });

    // Call Function：电源控制（执行操作）
    this.registerFunction('power_control', {
      description: '关机或重启电脑',
      prompt: `[关机] - 关闭电脑（1分钟后）\n[立即关机] - 立即关闭电脑\n[重启] - 重启电脑（1分钟后）\n[取消关机] - 取消关机或重启`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;

        const actions = {
          '[立即关机]': 'shutdown_now',
          '[关机]': 'shutdown',
          '[重启]': 'restart',
          '[取消关机]': 'cancel'
        };

        for (const [pattern, action] of Object.entries(actions)) {
          if (text.includes(pattern)) {
            functions.push({ type: 'power_control', params: { action } });
            cleanText = cleanText.replace(new RegExp(pattern.replace(/[\[\]]/g, '\\$&'), 'g'), '').trim();
            break;
          }
        }

        return { functions, cleanText };
      },
      handler: async (params = {}, context = {}) => {
        if (!this.requireWindows(context, '关机/重启功能')) return;

        const commands = {
          shutdown: { cmd: 'shutdown /s /t 60', delay: 60 },
          shutdown_now: { cmd: 'shutdown /s /t 0', delay: 0 },
          restart: { cmd: 'shutdown /r /t 60', delay: 60 },
          cancel: { cmd: 'shutdown /a' }
        };

        const { action } = params;
        const config = commands[action];
        if (!config) return;

        try {
          await execCommand(config.cmd);
          context.powerAction = action;
          if (config.delay !== undefined) {
            context.powerDelay = config.delay;
          }
        } catch (err) {
          if (action !== 'cancel') {
            this.handleError(context, err, '电源控制操作');
          }
        }
      },
      enabled: true
    });

    // Call Function：创建文件夹（执行操作）
    this.registerFunction('create_folder', {
      description: '在桌面创建文件夹',
      prompt: `[创建文件夹:folderName] - 在桌面创建指定名称的文件夹，例如：[创建文件夹:新建文件夹]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[创建文件夹:([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const folderName = (match[1] || '').trim();
          if (folderName) {
            functions.push({ type: 'create_folder', params: { folderName } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params = {}, context = {}) => {
        if (!this.requireWindows(context, '创建文件夹功能')) return;

        const { folderName } = params;
        if (!folderName) return;

        try {
          const workspace = this.getWorkspace();
          const safeName = this.sanitizeFileName(folderName);
          const folderPath = path.join(workspace, safeName);

          // 使用Node.js创建文件夹
          await fs.mkdir(folderPath, { recursive: true });

          context.createdFolder = safeName;
        } catch (err) {
          this.handleError(context, err, '创建文件夹');
        }
      },
      enabled: true
    });

    // Call Function：打开资源管理器（执行操作）
    this.registerFunction('open_explorer', {
      description: '打开文件管理器',
      prompt: `[打开资源管理器] 或 [打开文件夹] - 打开文件资源管理器`,
      parser: (text, context) => {
        if (!text.includes('[打开资源管理器]') && !text.includes('[打开文件夹]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'open_explorer', params: {} }],
          cleanText: text.replace(/\[打开资源管理器\]|\[打开文件夹\]/g, '').trim()
        };
      },
      handler: async (params = {}, context = {}) => {
        const commands = {
          win32: 'explorer',
          darwin: 'open .',
          linux: 'xdg-open .'
        };

        try {
          const command = commands[process.platform] || commands.linux;
          await execCommand(command);
        } catch (err) {
          this.handleError(context, err, '打开资源管理器');
        }
      },
      enabled: true
    });

    // MCP工具：查看磁盘空间（返回JSON结果）
    this.registerMCPTool('disk_space', {
      description: '查看各磁盘的使用情况',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (args = {}, context = {}) => {
        try {
          // 使用systeminformation库获取磁盘空间（跨平台）
          const fsSize = await si.fsSize();
          const disks = [];

          for (const disk of fsSize) {
            const totalGB = disk.size / 1024 / 1024 / 1024; // GB
            const usedGB = disk.used / 1024 / 1024 / 1024; // GB
            const freeGB = (disk.size - disk.used) / 1024 / 1024 / 1024; // GB
            const usedPercent = ((disk.used / disk.size) * 100).toFixed(1);

            disks.push({
              mount: disk.mount,
              usedPercent: parseFloat(usedPercent),
              freeGB: parseFloat(freeGB.toFixed(2)),
              totalGB: parseFloat(totalGB.toFixed(2)),
              usedGB: parseFloat(usedGB.toFixed(2)),
              display: `${disk.mount} ${usedPercent}% 已用 (${freeGB.toFixed(2)}GB / ${totalGB.toFixed(2)}GB 可用)`
            });
          }

          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.diskSpace = disks.length > 0 ? disks.map(d => d.display) : null;
          }

          return this.successResponse({
            disks,
            count: disks.length
          });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 获取磁盘空间失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('DISK_SPACE_FAILED', err.message);
        }
      },
      enabled: true
    });

    // Call Function：执行PowerShell命令（执行操作）
    this.registerFunction('execute_powershell', {
      description: '执行PowerShell命令（工作区：桌面）',
      prompt: `[执行命令:command] - 在工作区（桌面）执行PowerShell命令，例如：[执行命令:Get-ChildItem -Path "$env:USERPROFILE\\Desktop" -Filter "*.docx"]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[执行命令:([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const command = (match[1] || '').trim();
          if (command) {
            functions.push({ type: 'execute_powershell', params: { command } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params = {}, context = {}) => {
        if (!this.requireWindows(context, '执行PowerShell命令')) return;

        const { command } = params;
        if (!command) return;

        try {
          // 设置工作区为桌面
          const workspace = this.getWorkspace();
          const fullCommand = `cd "${workspace}"; ${command}`;

          const output = await execCommand(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${fullCommand.replace(/"/g, '\\"')}"`,
            { maxBuffer: 10 * 1024 * 1024, cwd: workspace },
            true
          );
          context.commandOutput = output.trim();
          context.commandSuccess = true;
        } catch (err) {
          context.commandError = err.message;
          context.commandSuccess = false;
          context.commandStderr = err.stderr || '';
          this.handleError(context, err, '执行PowerShell命令');
        }
      },
      enabled: true
    });

    // MCP工具：列出桌面文件（返回JSON结果）
    this.registerMCPTool('list_desktop_files', {
      description: '列出桌面上的文件和快捷方式',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (args = {}, context = {}) => {
        if (!IS_WINDOWS) {
          return this.errorResponse('WINDOWS_ONLY', '此功能仅在Windows系统上可用');
        }

        try {
          const workspace = this.getWorkspace();
          const files = await fs.readdir(workspace);
          const fileList = [];

          for (const file of files) {
            const filePath = path.join(workspace, file);
            try {
              const stats = await fs.stat(filePath);
              const isShortcut = file.endsWith('.lnk');
              fileList.push({
                name: file,
                type: isShortcut ? '快捷方式' : (stats.isDirectory() ? '文件夹' : '文件'),
                size: stats.isFile() ? stats.size : null
              });
            } catch (e) {
              // 忽略无法访问的文件
            }
          }

          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.desktopFiles = fileList;
          }

          // 在工作流中记录笔记
          const workflowId = context.workflowId || (context.stream?.context?.workflowId);
          if (workflowId && context.stream && Array.isArray(fileList) && fileList.length > 0) {
            const lines = fileList.map((item, index) => {
              const sizeText = typeof item.size === 'number'
                ? ` (${(item.size / 1024).toFixed(1)} KB)`
                : '';
              return `${index + 1}. [${item.type}] ${item.name}${sizeText}`;
            }).join('\n');

            try {
              await context.stream.storeNote(
                workflowId,
                `【桌面文件列表】\n工作区：${workspace}\n共 ${fileList.length} 个项目：\n${lines}`,
                'list_desktop_files',
                true
              );
            } catch {
              // 记笔记失败不影响主流程
            }
          }

          return this.successResponse({
            workspace,
            files: fileList,
            count: fileList.length
          });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 列出桌面文件失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('LIST_FILES_FAILED', err.message);
        }
      },
      enabled: true
    });

    // 注意：read/grep已移至MCP工具（tools.read, tools.grep），write/run/note已移至tools工作流
    // desktop工作流会与tools工作流合并，自动获得write/run/note功能

    // Call Function：打开应用（执行操作）
    this.registerFunction('open_application', {
      description: '打开应用程序',
      prompt: `[打开软件:appName] - 打开指定的软件，例如：[打开软件:微信] 或 [打开软件:notepad.exe]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[打开软件:([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const appName = (match[1] || '').trim();
          if (appName) {
            functions.push({ type: 'open_application', params: { appName } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params = {}, context = {}) => {
        if (!this.requireWindows(context, '打开软件')) return;

        const { appName } = params;
        if (!appName) return;

        try {
          // 先尝试在工作区查找快捷方式
          const workspace = this.getWorkspace();
          const files = await fs.readdir(workspace);
          let shortcutPath = null;

          for (const file of files) {
            if (file.endsWith('.lnk') && file.toLowerCase().includes(appName.toLowerCase())) {
              shortcutPath = path.join(workspace, file);
              break;
            }
          }

          if (shortcutPath) {
            // 使用Node.js打开快捷方式（Windows可以直接用start命令）
            await execAsync(`start "" "${shortcutPath}"`, { shell: 'cmd.exe' });
          } else {
            // 尝试直接启动程序（使用spawn）
            try {
              const child = spawn(appName, [], {
                detached: true,
                stdio: 'ignore',
                shell: true
              });
              child.unref();
            } catch (e) {
              // 如果spawn失败，使用cmd的start命令
              await execAsync(`start "" "${appName}"`, { shell: 'cmd.exe' });
            }
          }

          context.openedApp = appName;
        } catch (err) {
          this.handleError(context, err, '打开软件');
        }
      },
      enabled: true
    });

    // MCP工具：生成Word文档（返回JSON结果）
    this.registerMCPTool('create_word_document', {
      description: '创建Word文档，根据指定内容创建格式化的Word文档（.docx），支持标题、段落、表格等格式',
      inputSchema: {
        type: 'object',
        properties: {
          fileName: {
            type: 'string',
            description: '文件名（包含.docx扩展名）'
          },
          content: {
            type: 'string',
            description: '文档内容（支持多行）'
          }
        },
        required: ['fileName', 'content']
      },
      handler: async (args = {}, context = {}) => {
        const fileName = this.getParam(args, 'fileName', 'filename');
        const content = args.content;
        
        if (!fileName) throw new Error('文件名不能为空');
        if (!content) throw new Error('内容不能为空');

        try {
          // 动态导入docx库
          const docxModule = await import('docx');
          const { Document, Packer, Paragraph, TextRun } = docxModule;

          const workspace = this.getWorkspace();
          const safeFileName = this.sanitizeFileName(fileName);
          const filePath = path.join(workspace, safeFileName.endsWith('.docx') ? safeFileName : `${safeFileName}.docx`);

          // 将内容按换行符分割成段落
          const lines = content.split(/\n/);
          const docParagraphs = lines.map(line =>
            new Paragraph({
              children: [new TextRun(line || ' ')]
            })
          );

          // 创建Word文档
          const doc = new Document({
            sections: [{ properties: {}, children: docParagraphs }]
          });

          // 生成并保存文档
          const buffer = await Packer.toBuffer(doc);
          await fs.writeFile(filePath, buffer);

          // 验证文件是否生成
          const stats = await fs.stat(filePath);
          if (stats.size === 0) {
            throw new Error('Word文档文件为空');
          }

          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.createdWordDoc = filePath;
          }

          BotUtil.makeLog('info', `Word文档生成成功: ${filePath} (${stats.size} bytes)`, 'DesktopStream');
          
          return this.successResponse({
            filePath,
            fileName: safeFileName,
            size: stats.size
          });
        } catch (err) {
          BotUtil.makeLog('error', `Word文档生成失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('WORD_GENERATION_FAILED', err.message);
        }
      },
      enabled: true
    });

    // MCP工具：生成Excel文档（返回JSON结果）
    this.registerMCPTool('create_excel_document', {
      description: '创建Excel文档，数据必须是JSON数组格式',
      inputSchema: {
        type: 'object',
        properties: {
          fileName: {
            type: 'string',
            description: '文件名（包含.xlsx扩展名）'
          },
          data: {
            type: 'array',
            description: '数据数组，支持多种格式：1) 二维数组 [[header1, header2], [value1, value2]] 2) 对象数组 [{header1: value1, header2: value2}] 3) sheets格式 {sheets: [{name: "Sheet1", data: [[...]]}]}'
          }
        },
        required: ['fileName', 'data']
      },
      handler: async (args = {}, context = {}) => {
        const fileName = this.getParam(args, 'fileName');
        let data = this.getParam(args, 'data');
        
        if (!fileName) throw new Error('文件名不能为空');
        if (!data) throw new Error('数据不能为空');

        try {
          // 解析JSON数据
          data = this.parseJsonData(data);
          
          // 统一数据格式
          const sheets = this.normalizeExcelData(data);

          // 动态导入exceljs库
          const ExcelJSModule = await import('exceljs');
          const ExcelJS = ExcelJSModule.default || ExcelJSModule;

          const workspace = this.getWorkspace();
          const safeFileName = this.sanitizeFileName(fileName);
          const filePath = path.join(workspace, safeFileName.endsWith('.xlsx') ? safeFileName : `${safeFileName}.xlsx`);

          const workbook = new ExcelJS.Workbook();
          let totalRowCount = 0;

          // 处理每个工作表
          for (const sheetInfo of sheets) {
            const sheetName = sheetInfo.name || 'Sheet1';
            const sheetData = sheetInfo.data;
            
            if (!Array.isArray(sheetData) || sheetData.length === 0) {
              continue;
            }

            const worksheet = workbook.addWorksheet(sheetName);
            const headers = sheetData[0];
            
            if (!Array.isArray(headers)) {
              throw new Error('表头必须是数组格式');
            }

            // 设置表头
            worksheet.columns = headers.map((header, index) => ({
              header: String(header || `列${index + 1}`),
              key: `col${index}`,
              width: 15
            }));

            // 设置表头样式
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
            headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

            // 添加数据行
            for (let i = 1; i < sheetData.length; i++) {
              const rowData = sheetData[i];
              if (!Array.isArray(rowData)) continue;
              
              const paddedRow = [...rowData];
              while (paddedRow.length < headers.length) {
                paddedRow.push('');
              }
              
              worksheet.addRow(paddedRow).alignment = { vertical: 'middle', horizontal: 'left' };
            }

            // 自动调整列宽
            worksheet.columns.forEach(column => {
              if (!column.header) return;
              let maxLength = column.header.length;
              column.eachCell({ includeEmpty: false }, (cell) => {
                const cellValue = String(cell.value || '');
                if (cellValue.length > maxLength) maxLength = cellValue.length;
              });
              column.width = Math.min(Math.max(maxLength + 2, 10), 50);
            });

            totalRowCount += Math.max(0, sheetData.length - 1);
          }

          // 如果没有工作表，创建空工作表
          if (workbook.worksheets.length === 0) {
            workbook.addWorksheet('Sheet1').addRow(['数据为空']);
          }

          // 保存文件
          await workbook.xlsx.writeFile(filePath);

          // 验证文件
          const stats = await fs.stat(filePath);
          
          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.createdExcelDoc = filePath;
          }

          BotUtil.makeLog('info', `Excel文件生成成功: ${filePath}`, 'DesktopStream');
          
          return this.successResponse({
            filePath,
            fileName: safeFileName,
            size: stats.size,
            rowCount: totalRowCount,
            sheetCount: workbook.worksheets.length
          });
        } catch (err) {
          BotUtil.makeLog('error', `Excel生成失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('EXCEL_GENERATION_FAILED', err.message);
        }
      },
      enabled: true
    });


    // Call Function：清理进程（执行操作）
    this.registerFunction('cleanup_processes', {
      description: '清理无用进程',
      prompt: `[清理进程] - 清理已注册的无用进程`,
      parser: (text, context) => {
        if (!text.includes('[清理进程]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'cleanup_processes', params: {} }],
          cleanText: text.replace(/\[清理进程\]/g, '').trim()
        };
      },
      handler: async (params = {}, context = {}) => {
        const result = await this.tools.cleanupProcesses();
        context.processesCleaned = result.killed || [];
      },
      enabled: true
    });

    // Call Function：启动工作流（执行操作）
    this.registerFunction('start_workflow', {
      description: '启动多步骤工作流',
      prompt: `[启动工作流:goal] - 启动一个多步骤工作流，AI会自动规划步骤并执行，例如：[启动工作流:帮我打开微信并发送消息给张三]`,
      // 仅允许顶层调用，工作流内部会被过滤掉
      onlyTopLevel: true,
      parser: (text, context) => {
        const functions = [];
        const reg = /\[启动工作流:([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const goal = (match[1] || '').trim();
          if (goal) functions.push({ type: 'start_workflow', params: { goal } });
        }

        return {
          functions,
          cleanText: functions.length > 0 ? text.replace(reg, '').trim() : text
        };
      },
      handler: async (params = {}, context = {}) => {
        const { goal } = params;
        if (!goal || !this.workflowManager) return;

        // 禁止在已有工作流内部再次启动新的工作流，避免嵌套和重复创建
        if (context.workflowId) {
          BotUtil.makeLog('warn', `[start_workflow] 已忽略工作流内部请求："${goal}"（工作流ID: ${context.workflowId}）`, 'DesktopStream');
          try {
            await this.storeNote(context.workflowId, `已忽略嵌套工作流请求："${goal}"（当前已在工作流中）`, 'start_workflow', true);
          } catch {
            // 忽略笔记失败
          }
          return;
        }

        // 注意：自然语言回复已经在execute中发送了，这里不需要重复发送
        // 直接启动工作流
        try {
          const workflowId = await this.createWorkflowFromGoal(context.e, goal);
          context.workflowId = workflowId;
        } catch (err) {
          BotUtil.makeLog('error', `启动工作流失败: ${err.message}`, 'DesktopStream');
        }
      },
      enabled: true
    });
    // MCP工具：查询股票行情（返回JSON结果）
    this.registerMCPTool('stock_quote', {
      description: '查询单只A股实时行情，返回结构化数据（价格、涨跌、涨跌幅等），结果会自动记录到工作流笔记中',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '6位股票代码，例如：600519、000001'
          }
        },
        required: ['code']
      },
      handler: async (args = {}, context = {}) => {
        const code = (this.getParam(args, 'code', 'stockCode') || '').trim();
        const workflowId = context.workflowId || (context.stream?.context?.workflowId);

        // 验证股票代码格式（6位数字）
        if (!code) {
          return this.errorResponse('INVALID_PARAM', '股票代码不能为空');
        }

        if (!/^\d{6}$/.test(code)) {
          return this.errorResponse('INVALID_PARAM', `股票代码格式错误：${code}，应为6位数字（如：600519、000001）`);
        }

        try {
          const stockData = await this.fetchStockQuote(code);

          if (!stockData || !stockData.name) {
            const errorMsg = `股票代码 ${code} 不存在或数据无效`;
          if (workflowId && context.stream) {
            await context.stream.storeNote(
              workflowId,
              `【股票查询失败】\n代码：${code}\n原因：${errorMsg}`,
              'stock',
              true
            );
          }
            return this.errorResponse('STOCK_NOT_FOUND', errorMsg);
          }

          const {
            name,
            current,
            change,
            changePercent,
            open,
            preClose,
            high,
            low,
            date,
            time
          } = stockData;

          // 统一计算数值，避免重复解析
          const changeValue = parseFloat(change) || 0;
          const changePercentValue = parseFloat(changePercent) || 0;

          // 返回结构化数据
          const result = this.successResponse({
            code,
            name,
            price: current,
            change: changeValue,
            changePercent: changePercentValue,
            open,
            preClose,
            high,
            low,
            date,
            time
          });

          // 在工作流中记录笔记（供后续步骤使用）
          if (workflowId && context.stream) {
            const noteContent =
              `【股票行情查询】\n` +
              `代码：${code}\n名称：${name}\n` +
              `当前价：${current.toFixed(2)}\n` +
              `涨跌：${changeValue.toFixed(2)}（${changePercentValue.toFixed(2)}%）\n` +
              `今开：${open.toFixed(2)}  昨收：${preClose.toFixed(2)}\n` +
              `最高：${high.toFixed(2)}  最低：${low.toFixed(2)}\n` +
              (date && time ? `数据时间：${date} ${time}\n` : '') +
              `（本条笔记由股票信息工作流自动生成，供后续多步工作流分析与决策使用）`;

            await context.stream.storeNote(workflowId, noteContent, 'stock', true);
          }

          return result;
        } catch (error) {
          BotUtil.makeLog(
            'error',
            `股票行情查询异常(${code}): ${error.message}`,
            'DesktopStream'
          );

          if (workflowId && context.stream) {
            await context.stream.storeNote(
              workflowId,
              `【股票查询异常】\n代码：${code}\n错误：${error.message}`,
              'stock',
              true
            );
          }

          return this.errorResponse('STOCK_QUERY_FAILED', error.message);
        }
      },
      enabled: true
    });
  }

  /**
   * 解码GBK编码的响应数据
   * 优先使用iconv-lite，如果不可用则使用兼容方案
   */
  decodeGBKResponse(buffer) {
    try {
      const iconv = require('iconv-lite');
      return iconv.decode(buffer, 'gbk');
    } catch {
      // 如果iconv-lite不可用，尝试使用TextDecoder
      try {
        const decoder = new TextDecoder('gbk', { fatal: false });
        return decoder.decode(buffer);
      } catch {
        // 最后使用binary编码（兼容方案，可能无法完全正确解码）
        BotUtil.makeLog('warn', '股票数据解码：使用binary编码，名称可能显示异常，建议安装iconv-lite', 'DesktopStream');
        return buffer.toString('binary');
      }
    }
  }

  /**
   * 获取股票代码前缀（用于新浪API）
   * @param {string} code - 6位股票代码
   * @returns {string} 带前缀的代码（如 sh600941、sz000001）
   */
  _getStockPrefix(code) {
    if (code.startsWith('6')) return `sh${code}`;
    if (code.startsWith('0') || code.startsWith('3')) return `sz${code}`;
    return `sh${code}`; // 默认上海
  }

  /**
   * 解析股票数据
   * @param {string} data - API返回的原始数据
   * @param {string} prefixedCode - 带前缀的股票代码（如 sh600941）
   * @returns {Object|null} 解析后的股票数据
   */
  _parseStockData(data, prefixedCode) {
    try {
      const match = data.match(/="(.+)"/);
      if (!match?.[1]) {
        return null;
      }

      const fields = match[1].split(',');
      if (fields.length < 32) {
        return null;
      }

      // 解析股票名称（处理GBK编码）
      let name = (fields[0] || '').trim();
      if (!name || /^\d+$/.test(name)) {
        // 如果名称为空或是纯数字，使用股票代码
        name = prefixedCode.replace(/^(sh|sz)/, '') || '未知';
      } else if (/[\u4e00-\u9fa5]/.test(name)) {
        // 包含中文，清理特殊字符
        name = name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\-\(\)（）]/g, '').trim();
      }

      // 解析价格数据
      const preClose = parseFloat(fields[2]) || 0;
      const current = parseFloat(fields[3]) || 0;
      const change = preClose > 0 ? current - preClose : 0;
      const changePercent = preClose > 0 ? (change / preClose) * 100 : 0;

      return {
        code: prefixedCode,
        name,
        open: parseFloat(fields[1]) || 0,
        preClose,
        current,
        high: parseFloat(fields[4]) || 0,
        low: parseFloat(fields[5]) || 0,
        buy: parseFloat(fields[6]) || 0,
        sell: parseFloat(fields[7]) || 0,
        volume: parseInt(fields[8]) || 0,
        amount: parseFloat(fields[9]) || 0,
        change: change.toFixed(2),
        changePercent: changePercent.toFixed(2),
        date: fields[30] || '',
        time: fields[31] || ''
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取股票行情数据
   * @param {string} code - 6位股票代码
   * @returns {Promise<Object|null>} 股票数据对象
   */
  async fetchStockQuote(code) {
    const SINA_API = 'https://hq.sinajs.cn/list=';
    const REQUEST_DELAY = 300; // 请求延时（毫秒），避免频率过高
    const REQUEST_TIMEOUT = 10000; // 请求超时（毫秒）

    const prefixedCode = this._getStockPrefix(code);
    const url = `${SINA_API}${prefixedCode}`;

    // 适当延时，避免频率过高
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://finance.sina.com.cn',
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Connection: 'keep-alive'
      },
      timeout: REQUEST_TIMEOUT
    });

    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
    }

    // 获取响应数据并解码GBK编码
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = this.decodeGBKResponse(buffer);

    return this._parseStockData(text, prefixedCode);
  }

  /**
   * 构建功能列表提示
   * 注意：只包含 Call Function 的 prompt，MCP 工具不会出现在这里
   */
  buildFunctionsPrompt() {
    // 只获取 Call Function（MCP 工具不会出现在 prompt 中）
    const enabledFuncs = this.getEnabledFunctions();
    if (enabledFuncs.length === 0) return '';

    // 合并所有 Call Function 的 prompt
    const prompts = enabledFuncs
      .filter(f => f.prompt)
      .map(f => f.prompt);

    if (prompts.length === 0) return '';

    // 动态解析 prompt（如果为函数类型）
    const resolvedPrompts = prompts.map(p => typeof p === 'function' ? p() : p);

    return `【可执行命令列表】
在回复中使用以下格式时，系统会自动解析并执行，然后从文本中移除命令格式。

格式要求：精确匹配示例（类似正则），如[命令:参数1:参数2]。执行后命令格式会被移除，用户只看到普通文本。

重要：使用命令时，必须在回复中包含自然对话内容，不要只执行功能不说话！可以多说几句作为捧哏、提醒或告诫，让对话更生动自然。

可用命令：
${resolvedPrompts.join('\n')}

示例：
- "[打开计算器]好的，马上帮你打开计算器，这样你就可以算账啦~" → 执行打开计算器+回复文本
- "[回桌面]没问题，帮你回到桌面，这样找文件更方便" → 执行回桌面+回复文本
- "[启动工作流:帮我打开微信]好的，我来帮你规划并执行这个任务" → 启动多步骤工作流

【重要规则】
1. 格式完全匹配，参数完整，必须同时回复文本内容，不要只执行功能不回复
2. 【关键】启动工作流规则：
   - 只能输出一个[启动工作流:目标]命令
   - 启动工作流时，绝对禁止同时执行其他命令（如[股票:代码]、[回桌面]、[截屏]等）
   - 正确示例：[启动工作流:帮我回桌面然后再截图]好的，我来帮你完成这个任务
   - 错误示例：[股票:600941][启动工作流:查询股票并生成表格]（禁止同时执行）
   - 工作流启动后会自动执行所有步骤，不需要手动执行其他命令
   - 如果用户要求多步骤任务，必须使用[启动工作流:目标]，不要手动执行每一步`;
  }

  buildSystemPrompt(context) {
    const { question, e } = context;
    const persona =
      (question && (question.persona || question.PERSONA)) ||
      '你是一个智能桌面助手，帮助用户完成文件操作、系统管理等任务。';
    const functionsPrompt = this.buildFunctionsPrompt();
    const now = new Date().toLocaleString('zh-CN');
    const isMaster = e?.isMaster === true;
    const workspace = this.getWorkspace();

    // 优先从workflow context中获取文件内容（工作流场景）
    // 如果是在工作流中，workflowId会在context中
    let fileContent = context.fileContent;
    let fileSearchResult = context.fileSearchResult;
    let commandOutput = context.commandOutput;

    const workflowContext = this.getWorkflowContext(context);
    if (workflowContext) {
      fileContent = workflowContext.fileContent || fileContent;
      fileSearchResult = workflowContext.fileSearchResult || fileSearchResult;
      commandOutput = workflowContext.commandOutput || commandOutput;
    }

    const fileContext = this.buildFileContext(fileSearchResult, fileContent, commandOutput, context);

    return `【人设】
${persona}
【工作区】
工作区：${workspace}
- 文件操作默认在此目录进行

【核心工具】（write/run/note）
- [写入:文件路径:内容] - 写入文件
- [执行:命令] - 执行命令
- [笔记:内容] - 记录笔记（仅在工作流中可用）

【信息读取功能】
- 文件读取(read)、搜索(grep)、系统信息、磁盘空间、桌面文件列表等功能已移至MCP工具
- 可通过MCP协议调用：tools.read, tools.grep, desktop.system_info, desktop.disk_space, desktop.list_desktop_files
- 在工作流中，这些工具的结果会自动存到笔记

【Excel操作】
- Excel文档生成功能已移至MCP工具（desktop.create_excel_document），可通过MCP协议调用

【工作流笔记】
- 使用[笔记:内容]手动记录信息
   ${fileContext ? fileContext : ''}
【时间】
${now}
${isMaster ? '【权限】\n你拥有主人权限，可以执行所有系统操作。\n\n' : ''}${functionsPrompt ? `${functionsPrompt}\n\n` : ''}【规则】
1. 执行功能时必须回复文本内容，不要只执行不回复
2. 优先使用功能函数执行操作
3. 文件操作默认在工作区进行
4. 如果找到文件内容，请在回复中直接告知用户内容
5. 【关键】启动工作流规则：
   - 只能输出一个[启动工作流:目标]命令
   - 启动工作流时，只输出[启动工作流:目标]和自然语言回复
   - 绝对禁止在启动工作流时同时执行其他命令（如[股票:代码]、[回桌面]等）
   - 工作流启动后会自动执行所有步骤，不需要手动执行
   - 如果用户要求多步骤任务，必须使用[启动工作流:目标]，不要手动执行每一步

【任务类型判断】
- 简单任务：只需要一个操作即可完成，例如"查询股票"、"回到桌面"、"读取文件"
- 复杂任务：需要多个步骤才能完成，例如"查股票然后生成表格"、"读取多个文件并合并"
- 对于复杂任务，必须使用[启动工作流:目标]启动工作流，让系统自动执行所有步骤`;
  }

  async buildChatContext(e, question) {
    const messages = [];

    messages.push({
      role: 'system',
      content: this.buildSystemPrompt({ e, question })
    });

    const text = typeof question === 'string'
      ? question
      : (question?.content || question?.text || '');

    const userName =
      question?.userName ||
      question?.username ||
      e?.sender?.card ||
      e?.sender?.nickname ||
      '用户';

    const userId = question?.userId || e?.user_id || '';
    const prefix = userId ? `${userName}(${userId}): ` : `${userName}: `;

    if (this.embeddingConfig?.enabled && text) {
      const key =
        question?.conversationId ||
        e?.group_id ||
        `session_${userId || 'anonymous'}`;

      this.storeMessageWithEmbedding(key, {
        user_id: userId,
        nickname: userName,
        message: text,
        message_id: Date.now().toString(),
        time: Date.now()
      }).catch(() => { });
    }

    messages.push({
      role: 'user',
      content: `${prefix}${text}`
    });

    return messages;
  }

  /**
   * 从目标创建工作流
   */
  async createWorkflowFromGoal(e, goal) {
    // 先创建 workflow 对象（但不执行），以便记录决策步骤
    const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const tempWorkflow = this.workflowManager.createWorkflowObject(workflowId, goal, [], e);

    // 使用临时 workflow 对象记录决策步骤
    // 注意：任务分析助手不应该发送自然语言回复，只用于判断
    const decision = await this.workflowManager.decideWorkflowMode(e, goal, tempWorkflow);
    
    const todos = decision.todos.length > 0
      ? decision.todos
      : await this.workflowManager.generateInitialTodos(goal, tempWorkflow);

    // 创建正式的工作流，并合并决策步骤
    const finalWorkflowId = await this.workflowManager.createWorkflow(e, goal, todos);
    const finalWorkflow = this.workflowManager.getWorkflow(finalWorkflowId);

    // 将临时 workflow 的决策步骤复制到正式 workflow
    if (finalWorkflow && tempWorkflow.decisionSteps) {
      finalWorkflow.decisionSteps = tempWorkflow.decisionSteps;
    }

    return finalWorkflowId;
  }

  /**
   * 获取工作流上下文
   */
  getWorkflowContext(context) {
    if (!context.workflowId || !this.workflowManager) return null;

    const workflow = this.workflowManager.getWorkflow(context.workflowId);
    return workflow?.context || null;
  }

  /**
   * 构建文件上下文提示
   */
  buildFileContext(fileSearchResult, fileContent, commandOutput, context) {
    const sections = [];

    const fileSection = this.buildFileSection(fileSearchResult, fileContent, context);
    if (fileSection) sections.push(fileSection);

    const commandSection = this.buildCommandSection(commandOutput, context);
    if (commandSection) sections.push(commandSection);

    return sections.join('\n\n');
  }

  /**
   * 构建文件部分
   */
  buildFileSection(fileSearchResult, fileContent, context) {
    if (fileSearchResult?.found && fileContent) {
      const fileName = fileSearchResult.fileName || '文件';
      const filePath = fileSearchResult.path || '';
      const content = fileContent.slice(0, 2000);
      const truncated = fileContent.length > 2000 ? '\n...(内容已截断)' : '';
      return `【已找到文件内容】\n文件名：${fileName}\n${filePath ? `文件路径：${filePath}\n` : ''}文件内容如下：\n${content}${truncated}\n\n请在回复中直接告知用户上述文件内容，或使用此内容完成后续任务（如生成Excel）。`;
    }

    if (fileSearchResult?.found === false) {
      return `【文件查找结果】\n未找到文件：${context.fileError || '文件不存在'}`;
    }

    return '';
  }

  /**
   * 构建命令部分
   */
  buildCommandSection(commandOutput, context) {
    if (!commandOutput || !context.commandSuccess) return '';

    const output = commandOutput.slice(0, 1000);
    const truncated = commandOutput.length > 1000 ? '\n...(输出已截断)' : '';
    return `【上一个命令的输出结果】\n${output}${truncated}\n\n可以使用此输出结果来完成当前任务。`;
  }

  async cleanup() {
    if (this.processCleanupInterval) {
      clearInterval(this.processCleanupInterval);
      this.processCleanupInterval = null;
    }

    if (this.tools) {
      await this.tools.cleanupProcesses();
    }

    await super.cleanup();
  }
}
