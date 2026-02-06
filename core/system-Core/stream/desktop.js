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

const execCommand = (command, options = {}) => {
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
 * 所有功能都通过 MCP 工具提供：
 * - 系统操作：show_desktop、open_system_tool、lock_screen、power_control
 * - 文件操作：create_folder、open_explorer、open_application
 * - 网络操作：open_browser
 * - 命令执行：execute_powershell、cleanup_processes
 * - 信息读取：screenshot、system_info、disk_space、list_desktop_files
 * - 文档生成：create_word_document、create_excel_document
 * - 数据查询：stock_quote
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
        } catch {
          // 静默处理清理错误
        }
      }, 30000);
    }

  }

  handleError(error, operation, context = {}) {
    const handled = super.handleError(error, operation, context);
    if (context && typeof context === 'object') {
      context.lastError = { operation, message: error?.message || String(error) };
    }
    return handled;
  }

  requireWindows(context, _operation) {
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
   * 注册所有MCP工具
   */
  registerAllFunctions() {
    // MCP工具：回到桌面
    this.registerMCPTool('show_desktop', {
      description: '回到桌面 - 最小化所有窗口显示桌面（仅限Windows系统）。适用场景：用户想要清空屏幕、查看桌面文件、需要干净的工作环境、或准备进行截屏等操作时使用。',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        if (!this.requireWindows(context, '回桌面功能')) {
          return this.errorResponse('WINDOWS_ONLY', '此功能仅在Windows系统上可用');
        }

        try {
          await execAsync('powershell -Command "(New-Object -ComObject shell.application).MinimizeAll()"', { timeout: 5000 });
          return this.successResponse({ message: '已回到桌面' });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 回桌面失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('SHOW_DESKTOP_FAILED', err.message);
        }
      },
      enabled: true
    });

    // MCP工具：打开系统工具
    this.registerMCPTool('open_system_tool', {
      description: '打开Windows系统内置工具。支持的工具：notepad（记事本）、calc（计算器）、taskmgr（任务管理器）。当用户要求打开记事本、计算器或任务管理器时使用此功能。注意：这是打开应用程序，不是创建文档文件。',
      inputSchema: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            description: '要打开的系统工具名称，可选值：notepad（记事本）、calc（计算器）、taskmgr（任务管理器）',
            enum: ['notepad', 'calc', 'taskmgr']
          }
        },
        required: ['tool']
      },
      handler: async (_args = {}, context = {}) => {
        if (!this.requireWindows(context, '打开系统工具功能')) {
          return this.errorResponse('WINDOWS_ONLY', '此功能仅在Windows系统上可用');
        }

        const { tool } = args;
        if (!tool) {
          return this.errorResponse('INVALID_PARAM', '工具名称不能为空');
        }

        const toolNames = { notepad: '记事本', calc: '计算器', taskmgr: '任务管理器' };

        try {
          await execCommand(`start "" ${tool}`, { shell: 'cmd.exe' });
          return this.successResponse({ 
            message: `已打开${toolNames[tool] || '应用'}`,
            tool: toolNames[tool] || tool
          });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 打开系统工具失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('OPEN_SYSTEM_TOOL_FAILED', err.message);
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
      handler: async (_args = {}, context = {}) => {
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

    // MCP工具：锁屏
    this.registerMCPTool('lock_screen', {
      description: '锁定电脑屏幕',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        if (!this.requireWindows(context, '锁屏功能')) {
          return this.errorResponse('WINDOWS_ONLY', '此功能仅在Windows系统上可用');
        }

        try {
          await execCommand('rundll32.exe user32.dll,LockWorkStation');
          return this.successResponse({ message: '屏幕已锁定' });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 锁屏失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('LOCK_SCREEN_FAILED', err.message);
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
      handler: async (_args = {}, context = {}) => {
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

    // MCP工具：打开浏览器
    this.registerMCPTool('open_browser', {
      description: '打开浏览器访问网页',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要访问的网页URL，例如：https://www.baidu.com'
          }
        },
        required: ['url']
      },
      handler: async (args = {}, _context = {}) => {
        const url = this.getParam(args, 'url');
        if (!url) {
          return this.errorResponse('INVALID_PARAM', 'URL不能为空');
        }

        const commands = {
          win32: `start "" "${url}"`,
          darwin: `open "${url}"`,
          linux: `xdg-open "${url}"`
        };

        try {
          const command = commands[process.platform] || commands.linux;
          await execCommand(command, { shell: IS_WINDOWS ? 'cmd.exe' : undefined });
          return this.successResponse({ message: `已打开浏览器访问: ${url}`, url });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 打开浏览器失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('OPEN_BROWSER_FAILED', err.message);
        }
      },
      enabled: true
    });

    // MCP工具：电源控制
    this.registerMCPTool('power_control', {
      description: '关机或重启电脑',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '操作类型：shutdown（60秒后关机）、shutdown_now（立即关机）、restart（60秒后重启）、cancel（取消关机/重启）',
            enum: ['shutdown', 'shutdown_now', 'restart', 'cancel']
          }
        },
        required: ['action']
      },
      handler: async (_args = {}, context = {}) => {
        if (!this.requireWindows(context, '关机/重启功能')) {
          return this.errorResponse('WINDOWS_ONLY', '此功能仅在Windows系统上可用');
        }

        const commands = {
          shutdown: { cmd: 'shutdown /s /t 60', delay: 60 },
          shutdown_now: { cmd: 'shutdown /s /t 0', delay: 0 },
          restart: { cmd: 'shutdown /r /t 60', delay: 60 },
          cancel: { cmd: 'shutdown /a' }
        };

        const { action } = args;
        if (!action) {
          return this.errorResponse('INVALID_PARAM', '操作类型不能为空');
        }

        const config = commands[action];
        if (!config) {
          return this.errorResponse('INVALID_PARAM', `不支持的操作类型: ${action}`);
        }

        try {
          await execCommand(config.cmd);
          return this.successResponse({ 
            message: action === 'cancel' ? '已取消关机/重启' : `已执行${action}操作`,
            action,
            delay: config.delay
          });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 电源控制失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('POWER_CONTROL_FAILED', err.message);
        }
      },
      enabled: true
    });

    // MCP工具：创建文件夹
    this.registerMCPTool('create_folder', {
      description: '在桌面创建文件夹',
      inputSchema: {
        type: 'object',
        properties: {
          folderName: {
            type: 'string',
            description: '文件夹名称'
          }
        },
        required: ['folderName']
      },
      handler: async (_args = {}, context = {}) => {
        if (!this.requireWindows(context, '创建文件夹功能')) {
          return this.errorResponse('WINDOWS_ONLY', '此功能仅在Windows系统上可用');
        }

        const { folderName } = args;
        if (!folderName) {
          return this.errorResponse('INVALID_PARAM', '文件夹名称不能为空');
        }

        try {
          const workspace = this.getWorkspace();
          const safeName = this.sanitizeFileName(folderName);
          const folderPath = path.join(workspace, safeName);

          await fs.mkdir(folderPath, { recursive: true });

          return this.successResponse({ 
            message: `已创建文件夹: ${safeName}`,
            folderPath,
            folderName: safeName
          });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 创建文件夹失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('CREATE_FOLDER_FAILED', err.message);
        }
      },
      enabled: true
    });

    // MCP工具：打开资源管理器
    this.registerMCPTool('open_explorer', {
      description: '打开文件管理器',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, _context = {}) => {
        const commands = {
          win32: 'explorer',
          darwin: 'open .',
          linux: 'xdg-open .'
        };

        try {
          const command = commands[process.platform] || commands.linux;
          await execCommand(command);
          return this.successResponse({ message: '已打开文件管理器' });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 打开资源管理器失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('OPEN_EXPLORER_FAILED', err.message);
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
      handler: async (_args = {}, context = {}) => {
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

    // MCP工具：执行PowerShell命令
    this.registerMCPTool('execute_powershell', {
      description: '执行PowerShell命令（工作区：桌面）',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的PowerShell命令'
          }
        },
        required: ['command']
      },
      handler: async (args = {}, context = {}) => {
        if (!this.requireWindows(context, '执行PowerShell命令')) {
          return this.errorResponse('WINDOWS_ONLY', '此功能仅在Windows系统上可用');
        }

        const { command } = args;
        if (!command) {
          return this.errorResponse('INVALID_PARAM', '命令不能为空');
        }

        try {
          const workspace = this.getWorkspace();
          const fullCommand = `cd "${workspace}"; ${command}`;

          const output = await execCommand(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${fullCommand.replace(/"/g, '\\"')}"`,
            { maxBuffer: 10 * 1024 * 1024, cwd: workspace }
          );

          return this.successResponse({ 
            message: '命令执行成功',
            output: output.trim(),
            command
          });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 执行PowerShell命令失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('EXECUTE_POWERSHELL_FAILED', err.message, {
            stderr: err.stderr || ''
          });
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
      handler: async (_args = {}, context = {}) => {
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
            } catch {
              // 忽略无法访问的文件
            }
          }

          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.desktopFiles = fileList;
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

    // MCP工具：打开应用
    this.registerMCPTool('open_application', {
      description: '打开应用程序',
      inputSchema: {
        type: 'object',
        properties: {
          appName: {
            type: 'string',
            description: '要打开的应用程序名称或路径'
          }
        },
        required: ['appName']
      },
      handler: async (args = {}, context = {}) => {
        if (!this.requireWindows(context, '打开软件')) {
          return this.errorResponse('WINDOWS_ONLY', '此功能仅在Windows系统上可用');
        }

        const { appName } = args;
        if (!appName) {
          return this.errorResponse('INVALID_PARAM', '应用程序名称不能为空');
        }

        try {
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
            await execAsync(`start "" "${shortcutPath}"`, { shell: 'cmd.exe' });
            return this.successResponse({ 
              message: `已打开应用程序: ${appName}`,
              appName,
              shortcutPath
            });
          } else {
            try {
              const child = spawn(appName, [], {
                detached: true,
                stdio: 'ignore',
                shell: true
              });
              child.unref();
            } catch {
              await execAsync(`start "" "${appName}"`, { shell: 'cmd.exe' });
            }
            return this.successResponse({ 
              message: `已打开应用程序: ${appName}`,
              appName
            });
          }
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 打开应用程序失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('OPEN_APPLICATION_FAILED', err.message);
        }
      },
      enabled: true
    });

    // MCP工具：生成Word文档（返回JSON结果）
    this.registerMCPTool('create_word_document', {
      description: '生成并保存Word文档文件（.docx格式）。根据提供的文件名和内容创建新的Word文档文件并保存到桌面。注意：这是创建文档文件，不是打开记事本应用程序。如果用户要求"打开记事本"，应使用open_system_tool工具，而不是此工具。',
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


    // MCP工具：清理进程
    this.registerMCPTool('cleanup_processes', {
      description: '清理无用进程',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, _context = {}) => {
        try {
          const result = await this.tools.cleanupProcesses();
          return this.successResponse({ 
            message: '进程清理完成',
            killed: result.killed || [],
            count: (result.killed || []).length
          });
        } catch (err) {
          BotUtil.makeLog('error', `[desktop] 清理进程失败: ${err.message}`, 'DesktopStream');
          return this.errorResponse('CLEANUP_PROCESSES_FAILED', err.message);
        }
      },
      enabled: true
    });

    // MCP工具：查询股票行情（返回JSON结果）
    this.registerMCPTool('stock_quote', {
      description: '查询单只A股实时行情，返回结构化数据（价格、涨跌、涨跌幅等）',
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
      handler: async (args = {}, _context = {}) => {
        const code = (this.getParam(args, 'code', 'stockCode') || '').trim();

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


          return result;
        } catch (error) {
          BotUtil.makeLog(
            'error',
            `股票行情查询异常(${code}): ${error.message}`,
            'DesktopStream'
          );


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
    // 只获取启用的 Call Function（MCP 工具不会出现在 prompt 中）
    const enabledFuncs = this.getEnabledFunctions();
    if (enabledFuncs.length === 0) return '';

    // 只作为“能力说明”，不再约定任何特殊的文本命令格式
    const lines = enabledFuncs
      .filter(f => f.description)
      .map(f => `- ${f.description}`);

    if (lines.length === 0) return '';

    return `【可用能力】
你具备以下桌面/系统相关能力，这些能力会通过系统的工具调用协议（tool calling + MCP）自动触发。
你只需要用自然语言思考和回答，不要在回复中设计特殊命令格式或人为添加标记。

当用户的需求与下列能力相关时，请优先考虑调用相应工具来完成任务：
${lines.join('\n')}`;
  }

  buildSystemPrompt(context) {
    const { question, e } = context;
    const persona =
      (question && (question.persona || question.PERSONA)) ||
      '你是一个智能桌面助手，帮助用户完成文件操作、系统管理等任务。';
    const now = new Date().toLocaleString('zh-CN');
    const isMaster = e?.isMaster === true;
    const workspace = this.getWorkspace();

    const fileContent = context.fileContent;
    const fileSearchResult = context.fileSearchResult;
    const commandOutput = context.commandOutput;

    const fileContext = this.buildFileContext(fileSearchResult, fileContent, commandOutput, context);

    return `【人设】
${persona}
【工作区】
工作区：${workspace}
- 文件操作默认在此目录进行

【工具说明】
所有功能都通过MCP工具调用协议提供，包括：
- 系统操作：show_desktop, open_system_tool, lock_screen, power_control
- 文件操作：create_folder, open_explorer, open_application
- 网络操作：open_browser
- 命令执行：execute_powershell, cleanup_processes
- 信息读取：screenshot, system_info, disk_space, list_desktop_files
- 文档生成：create_word_document, create_excel_document
- 数据查询：stock_quote

${fileContext ? `【上下文】\n${fileContext}\n` : ''}
【时间】
${now}
${isMaster ? '【权限】\n你拥有主人权限，可以执行所有系统操作。\n\n' : ''}【规则】
1. 执行功能时必须回复文本内容，不要只执行不回复
2. 优先使用MCP工具执行操作
3. 文件操作默认在工作区进行
4. 如果找到文件内容，请在回复中直接告知用户内容
`;
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

    // 从事件中提取图片（OneBot segments / device segments）
    // Web 客户端通过 WS -> http/device.js 会把 payload.message 作为 e.message 透传到工作流
    const images = [];
    if (e && Array.isArray(e.message)) {
      for (const seg of e.message) {
        if (!seg || typeof seg !== 'object') continue;
        if (seg.type !== 'image') continue;
        const url = seg.url || seg.data?.url || seg.data?.file;
        if (url) images.push(url);
      }
    }

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

    // 多模态：若存在图片，则按 {text, images} 结构交给 LLM 工厂统一转各家协议
    if (images.length > 0) {
      messages.push({
        role: 'user',
        content: {
          text: `${prefix}${text}`,
          images
        }
      });
    } else {
      messages.push({
        role: 'user',
        content: `${prefix}${text}`
      });
    }

    return messages;
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
