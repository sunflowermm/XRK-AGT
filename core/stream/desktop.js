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

// 仅在需要的平台上做判断，避免无意义的常量
const IS_WINDOWS = process.platform === 'win32';
const execAsync = promisify(exec);

// 统一的命令执行函数
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
 * 桌面助手工作流
 * 提供系统操作、文件管理、信息查询等实用功能
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
      embedding: {
        enabled: true,
        provider: 'lightweight'
      }
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

    try {
      await this.initEmbedding();
    } catch (error) {
      // Embedding初始化失败，继续运行
    }

    // 先注册自己的函数
    this.registerAllFunctions();
    BotUtil.makeLog('info', `[${this.name}] 注册函数完成: ${this.functions.size} 个`, 'DesktopStream');

    // 合并 ToolsStream（提供 read/grep/write/run 核心工具）
    try {
      const ToolsStream = (await import('./tools.js')).default;
      const toolsStream = new ToolsStream();
      await toolsStream.init();
      
      const result = this.merge(toolsStream);
      BotUtil.makeLog('info', `[${this.name}] 已合并 ToolsStream: +${result.mergedCount} 个函数，总计: ${this.functions.size} 个`, 'DesktopStream');
    } catch (error) {
      BotUtil.makeLog('error', `[${this.name}] 合并 ToolsStream 失败: ${error.message}`, 'DesktopStream');
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
    
    BotUtil.makeLog('info', `[${this.name}] 工作流已初始化`, 'DesktopStream');
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

  registerAllFunctions() {
    this.registerFunction('show_desktop', {
      description: '回到桌面',
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
      handler: async (params, context) => {
        if (!this.requireWindows(context, '回桌面功能')) return;

        try {
          await execAsync('powershell -Command "(New-Object -ComObject shell.application).MinimizeAll()"', { timeout: 5000 });
        } catch (err) {
          this.handleError(context, err, '回桌面操作');
        }
      },
      enabled: true
    });

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
      handler: async (params, context) => {
        if (!this.requireWindows(context, '打开系统工具功能')) return;

        const tool = params?.tool;
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
    this.registerFunction('screenshot', {
      description: '截屏',
      prompt: `[截屏] 或 [截图] - 截取当前屏幕`,
      parser: (text, context) => {
        if (!text.includes('[截屏]') && !text.includes('[截图]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'screenshot', params: {} }],
          cleanText: text.replace(/\[截屏\]|\[截图\]/g, '').trim()
        };
      },
      handler: async (params, context) => {
        try {
          // 动态导入screenshot-desktop库
          const screenshot = (await import('screenshot-desktop')).default;
          
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const screenshotDir = path.join(paths.trash, 'screenshot');
          await fs.mkdir(screenshotDir, { recursive: true });
          
          const filename = `screenshot_${timestamp}.png`;
          const screenshotPath = path.join(screenshotDir, filename);
          
          // 使用screenshot-desktop库截图（支持多显示器）
          const img = await screenshot({ screen: -1 }); // -1表示所有屏幕
          
          // 保存截图
          await fs.writeFile(screenshotPath, img);
          
          // 验证文件是否生成
          const stats = await fs.stat(screenshotPath);
          if (stats.size === 0) {
            throw new Error('截屏文件为空');
          }
    
          if (context.e) {
            // 仅发送图片，由 AI 在对话中自然说明，无需额外的"截图成功"提示
            await context.e.reply([
              { type: 'image', data: { file: screenshotPath } }
            ]);
          }
          
          BotUtil.makeLog('info', `截图成功: ${screenshotPath} (${stats.size} bytes)`, 'DesktopStream');
        } catch (err) {
          // 截屏失败时只记录日志，不向用户额外发送「截屏失败」类提示，
          // 由 AI 在对话中根据需要自行说明。
          BotUtil.makeLog('error', `[desktop] 截屏失败: ${err.message}`, 'DesktopStream');
        }
      },
      enabled: true
    });

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
      handler: async (params, context) => {
        if (!this.requireWindows(context, '锁屏功能')) return;

        try {
          await execCommand('rundll32.exe user32.dll,LockWorkStation');
        } catch (err) {
          this.handleError(context, err, '锁屏操作');
        }
      },
      enabled: true
    });

    this.registerFunction('system_info', {
      description: '查看系统信息',
      prompt: `[系统信息] - 查看电脑的 CPU、内存使用情况`,
      parser: (text, context) => {
        if (!text.includes('[系统信息]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'system_info', params: {} }],
          cleanText: text.replace(/\[系统信息\]/g, '').trim()
        };
      },
      handler: async (params, context) => {
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

          context.systemInfo = {
            cpu: `${cpuUsage}%`,
            memory: {
              usedPercent: `${memUsedPercent}%`,
              freeGB: `${memFree.toFixed(2)}GB`,
              totalGB: `${memTotal.toFixed(2)}GB`,
              usedGB: `${memUsed.toFixed(2)}GB`
            }
          };
        } catch (err) {
          this.handleError(context, err, '获取系统信息');
        }
      },
      enabled: true
    });

    this.registerFunction('open_browser', {
      description: '打开浏览器访问网页',
      prompt: `[打开网页:网址] - 在浏览器中打开指定网页，例如：[打开网页:https://www.baidu.com]`,
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
      handler: async (params, context) => {
        const url = params?.url;
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
      handler: async (params, context) => {
        if (!this.requireWindows(context, '关机/重启功能')) return;

        const commands = {
          shutdown: { cmd: 'shutdown /s /t 60', delay: 60 },
          shutdown_now: { cmd: 'shutdown /s /t 0', delay: 0 },
          restart: { cmd: 'shutdown /r /t 60', delay: 60 },
          cancel: { cmd: 'shutdown /a' }
        };

        const action = params?.action;
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

    this.registerFunction('create_folder', {
      description: '在桌面创建文件夹',
      prompt: `[创建文件夹:文件夹名] - 在桌面创建指定名称的文件夹，例如：[创建文件夹:新建文件夹]`,
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
      handler: async (params, context) => {
        if (!this.requireWindows(context, '创建文件夹功能')) return;

        const folderName = params?.folderName;
        if (!folderName) return;

        try {
          const workspace = this.getWorkspace();
          const safeName = folderName.replace(/[<>:"/\\|?*]/g, '_');
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
      handler: async (params, context) => {
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

    this.registerFunction('disk_space', {
      description: '查看磁盘空间',
      prompt: `[磁盘空间] - 查看各磁盘的使用情况`,
      parser: (text, context) => {
        if (!text.includes('[磁盘空间]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'disk_space', params: {} }],
          cleanText: text.replace(/\[磁盘空间\]/g, '').trim()
        };
      },
      handler: async (params, context) => {
        try {
          // 使用systeminformation库获取磁盘空间（跨平台）
          const fsSize = await si.fsSize();
          const disks = [];

          for (const disk of fsSize) {
            const totalGB = disk.size / 1024 / 1024 / 1024; // GB
            const usedGB = disk.used / 1024 / 1024 / 1024; // GB
            const freeGB = (disk.size - disk.used) / 1024 / 1024 / 1024; // GB
            const usedPercent = ((disk.used / disk.size) * 100).toFixed(1);
            
            disks.push(`${disk.mount} ${usedPercent}% 已用 (${freeGB.toFixed(2)}GB / ${totalGB.toFixed(2)}GB 可用)`);
          }

          context.diskSpace = disks.length > 0 ? disks : null;
        } catch (err) {
          this.handleError(context, err, '获取磁盘空间');
        }
      },
      enabled: true
    });

    // 执行PowerShell命令（支持错误重试）
    this.registerFunction('execute_powershell', {
      description: '执行PowerShell命令（工作区：桌面）',
      prompt: `[执行命令:PowerShell命令] - 在工作区（桌面）执行PowerShell命令，例如：[执行命令:Get-ChildItem -Path "$env:USERPROFILE\\Desktop" -Filter "*.docx"]`,
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
      handler: async (params, context) => {
        if (!this.requireWindows(context, '执行PowerShell命令')) return;

        const command = params?.command;
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

    // 新增：列出桌面文件
    this.registerFunction('list_desktop_files', {
      description: '列出桌面上的文件和快捷方式',
      prompt: `[列出桌面文件] - 查看桌面上的所有文件和快捷方式`,
      parser: (text, context) => {
        if (!text.includes('[列出桌面文件]')) {
          return { functions: [], cleanText: text };
        }
        return {
          functions: [{ type: 'list_desktop_files', params: {} }],
          cleanText: text.replace(/\[列出桌面文件\]/g, '').trim()
        };
      },
      handler: async (params, context) => {
        if (!this.requireWindows(context, '列出桌面文件')) return;

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

          context.desktopFiles = fileList;

          // 在多步工作流中，将桌面文件列表写入笔记，供后续步骤和其他插件读取
          if (context.workflowId && Array.isArray(fileList) && fileList.length > 0) {
            const lines = fileList.map((item, index) => {
              const sizeText = typeof item.size === 'number'
                ? ` (${(item.size / 1024).toFixed(1)} KB)`
                : '';
              return `${index + 1}. [${item.type}] ${item.name}${sizeText}`;
            }).join('\n');

            try {
              await this.storeNote(
                context.workflowId,
                `【桌面文件列表】\n工作区：${workspace}\n共 ${fileList.length} 个项目：\n${lines}`,
                'list_desktop_files',
                true
              );
            } catch {
              // 记笔记失败不影响主流程
            }
          }
        } catch (err) {
          this.handleError(context, err, '列出桌面文件');
        }
      },
      enabled: true
    });

    // 注意：read/grep/write/run已移至tools工作流，这里不再重复注册
    // desktop工作流会与tools工作流合并，自动获得这些功能

    // 新增：打开软件（通过快捷方式或程序名）
    this.registerFunction('open_application', {
      description: '打开应用程序',
      prompt: `[打开软件:软件名] - 打开指定的软件，例如：[打开软件:微信] 或 [打开软件:notepad.exe]`,
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
      handler: async (params, context) => {
        if (!this.requireWindows(context, '打开软件')) return;

        const appName = params?.appName;
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

    // 新增：生成Word文档
    this.registerFunction('create_word_document', {
      description: '创建Word文档',
      prompt: `[生成Word:文件名:内容] - 创建Word文档，例如：[生成Word:报告.docx:这是文档内容]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[生成Word:([^:]+):([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const fileName = (match[1] || '').trim();
          const content = (match[2] || '').trim();
          if (fileName && content) {
            functions.push({ type: 'create_word_document', params: { fileName, content } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        const fileName = params?.fileName;
        const content = params?.content;
        if (!fileName || !content) return;

        try {
          // 动态导入docx库
          const docxModule = await import('docx');
          const { Document, Packer, Paragraph, TextRun } = docxModule;
          
          const workspace = this.getWorkspace();
          const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
          const filePath = path.join(workspace, safeFileName.endsWith('.docx') ? safeFileName : `${safeFileName}.docx`);

          // 将内容按换行符分割成段落
          // 保留空行（如果原内容中有空行）
          const lines = content.split(/\n/);
          const docParagraphs = lines.map(line => 
            new Paragraph({
              children: [new TextRun(line || ' ')] // 空行用空格代替
            })
          );

          // 创建Word文档
          const doc = new Document({
            sections: [
              {
                properties: {},
                children: docParagraphs
              }
            ]
          });

          // 生成并保存文档
          const buffer = await Packer.toBuffer(doc);
          await fs.writeFile(filePath, buffer);
          
          // 验证文件是否生成
          const stats = await fs.stat(filePath);
          if (stats.size === 0) {
            throw new Error('Word文档文件为空');
          }
          
          context.createdWordDoc = filePath;
          
          // 发送成功消息
          if (context.e) {
            await context.e.reply(`✅ Word文档已生成：${safeFileName}`);
          }
          
          BotUtil.makeLog('info', `Word文档生成成功: ${filePath} (${stats.size} bytes)`, 'DesktopStream');
        } catch (err) {
          BotUtil.makeLog('error', `Word文档生成失败: ${err.message}`, 'DesktopStream');
          this.handleError(context, err, '生成Word文档');
        }
      },
      enabled: true
    });

    // 生成Excel文档（只接收JSON数组格式，不做文本解析）
    this.registerFunction('create_excel_document', {
      description: '创建Excel文档',
      prompt: `[生成Excel:文件名:JSON数组] - 创建Excel文档，数据必须是JSON数组格式，例如：[生成Excel:数据表.xlsx:[{"姓名":"张三","年龄":25},{"姓名":"李四","年龄":30}]]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        
        // 使用更智能的匹配方式，能够处理JSON数组中包含的]字符
        const pattern = /\[生成Excel:([^:]+):/g;
        let match;
        const matches = [];
        
        // 先找到所有[生成Excel:的位置
        while ((match = pattern.exec(text)) !== null) {
          matches.push({
            start: match.index,
            fileName: match[1].trim(),
            dataStart: match.index + match[0].length
          });
        }
        
        // 对每个匹配，尝试解析JSON数组（从后往前处理，避免索引问题）
        const toRemove = [];
        for (let i = matches.length - 1; i >= 0; i--) {
          const m = matches[i];
          const afterColon = text.slice(m.dataStart);
          
          // 尝试找到完整的JSON数组（从[开始到匹配的]结束）
          let bracketCount = 0;
          let jsonEnd = -1;
          let inString = false;
          let escapeNext = false;
          
          for (let j = 0; j < afterColon.length; j++) {
            const char = afterColon[j];
            
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            
            if (char === '"') {
              inString = !inString;
              continue;
            }
            
            if (inString) continue;
            
            if (char === '[') {
              bracketCount++;
            } else if (char === ']') {
              bracketCount--;
              if (bracketCount === 0) {
                // 找到了JSON数组的结束位置
                jsonEnd = j + 1;
                break;
              }
            }
          }
          
          if (jsonEnd > 0) {
            // jsonEnd是JSON数组结束的位置（包括]），需要检查后面是否还有命令结束符]
            let commandEnd = jsonEnd;
            if (afterColon[jsonEnd] === ']') {
              commandEnd = jsonEnd + 1;
            }
            
            // 提取JSON数组字符串（不包括命令结束符]）
            const dataStr = afterColon.slice(0, jsonEnd).trim();
            if (dataStr.startsWith('[') && dataStr.endsWith(']')) {
              try {
                const data = JSON.parse(dataStr);
                if (!Array.isArray(data)) {
                  continue;
                }
                functions.push({ 
                  type: 'create_excel_document', 
                  params: { fileName: m.fileName, data },
                  order: m.start
                });
                
                // 记录需要移除的部分（从后往前处理，所以索引不会变化）
                toRemove.push({
                  start: m.start,
                  end: m.dataStart + commandEnd
                });
              } catch (e) {
                // JSON解析失败，跳过
                BotUtil.makeLog('debug', `Excel命令JSON解析失败: ${e.message}`, 'DesktopStream');
              }
            }
          }
        }
        
        // 从后往前移除匹配的部分，避免索引变化
        if (toRemove.length > 0) {
          let result = text;
          // 按start位置从大到小排序，从后往前移除
          toRemove.sort((a, b) => b.start - a.start);
          for (const remove of toRemove) {
            result = result.slice(0, remove.start) + result.slice(remove.end);
          }
          cleanText = result.trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        const fileName = params?.fileName;
        const data = params?.data;
        if (!fileName || !data) return;

        if (!Array.isArray(data)) {
          throw new Error('数据必须是数组格式');
        }

        try {
          // 动态导入exceljs库
          const ExcelJSModule = await import('exceljs');
          const ExcelJS = ExcelJSModule.default || ExcelJSModule;
          
          // 使用工作区路径（桌面）
          const workspace = this.getWorkspace();
          const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
          const filePath = path.join(workspace, safeFileName.endsWith('.xlsx') ? safeFileName : `${safeFileName}.xlsx`);

          // 创建工作簿和工作表
          const workbook = new ExcelJS.Workbook();
          const worksheet = workbook.addWorksheet('Sheet1');

          if (data.length > 0) {
            // 获取表头（从第一条数据的键）
            const headers = Object.keys(data[0]);
            
            // 设置表头样式
            worksheet.columns = headers.map(header => ({
              header: header,
              key: header,
              width: 15
            }));

            // 设置表头行样式
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD3D3D3' }
            };
            headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

            // 添加数据行
            data.forEach((rowData, index) => {
              const row = worksheet.addRow(rowData);
              row.alignment = { vertical: 'middle', horizontal: 'left' };
            });

            // 自动调整列宽
            worksheet.columns.forEach(column => {
              if (column.header) {
                let maxLength = column.header.length;
                column.eachCell({ includeEmpty: false }, (cell) => {
                  const cellValue = cell.value ? String(cell.value) : '';
                  if (cellValue.length > maxLength) {
                    maxLength = cellValue.length;
                  }
                });
                column.width = Math.min(Math.max(maxLength + 2, 10), 50);
              }
            });
          } else {
            // 数据为空
            worksheet.addRow(['数据为空']);
          }

          // 保存文件
          await workbook.xlsx.writeFile(filePath);
          
          // 验证文件是否生成
          try {
            await fs.access(filePath);
            context.createdExcelDoc = filePath;
            
            // 发送成功消息
            if (context.e) {
              await context.e.reply(`✅ Excel文件已生成：${safeFileName}`);
            }
            
            BotUtil.makeLog('info', `Excel文件生成成功: ${filePath}`, 'DesktopStream');
          } catch (fileErr) {
            throw new Error(`Excel文件未生成：${fileErr.message}`);
          }
        } catch (err) {
          BotUtil.makeLog('error', `Excel生成失败: ${err.message}`, 'DesktopStream');
          this.handleError(context, err, '生成Excel文档');
        }
      },
      enabled: true
    });

    // 自动清理无用进程（在执行函数后调用）
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
      handler: async (params, context) => {
        const result = await this.tools.cleanupProcesses();
        context.processesCleaned = result.killed || [];
      },
      enabled: true
    });

    this.registerFunction('start_workflow', {
      description: '启动多步骤工作流',
      prompt: `[启动工作流:目标描述] - 启动一个多步骤工作流，AI会自动规划步骤并执行，例如：[启动工作流:帮我打开微信并发送消息给张三]`,
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
      handler: async (params, context) => {
        const goal = params?.goal;
        if (!goal || !this.workflowManager) return;

        // 禁止在已有工作流内部再次启动新的工作流，避免嵌套和重复创建
        // 这个检查必须放在最前面，避免任何可能触发任务分析的调用
        if (context.workflowId) {
          BotUtil.makeLog('warn', `[start_workflow] 已忽略工作流内部请求："${goal}"（工作流ID: ${context.workflowId}）`, 'DesktopStream');
          try {
            await this.storeNote(context.workflowId, `已忽略嵌套工作流请求："${goal}"（当前已在工作流中）`, 'start_workflow', true);
          } catch {
            // 忽略笔记失败
          }
          return;
        }

        try {
          const workflowId = await this.createWorkflowFromGoal(context.e, goal);
          context.workflowId = workflowId;
        } catch (err) {
          BotUtil.makeLog('error', `启动工作流失败: ${err.message}`, 'DesktopStream');
        }
      },
      enabled: true
    });
  }


  /**
   * 构建功能列表提示（优化版）
   * 清晰说明功能列表的作用、使用方式和执行机制
   */
  buildFunctionsPrompt() {
    const enabledFuncs = this.getEnabledFunctions();
    if (enabledFuncs.length === 0) return '';

    const prompts = enabledFuncs
      .filter(f => f.prompt)
      .map(f => f.prompt);

    if (prompts.length === 0) return '';

    return `【可执行命令列表】
在回复中使用以下格式时，系统会自动解析并执行，然后从文本中移除命令格式。

格式要求：精确匹配示例（类似正则），如[命令:参数1:参数2]。执行后命令格式会被移除，用户只看到普通文本。

重要：使用命令时，必须在回复中包含自然对话内容，不要只执行功能不说话！可以多说几句作为捧哏、提醒或告诫，让对话更生动自然。

可用命令：
${prompts.join('\n')}

示例：
- "[打开计算器]好的，马上帮你打开计算器，这样你就可以算账啦~" → 执行打开计算器+回复文本
- "[回桌面]没问题，帮你回到桌面，这样找文件更方便" → 执行回桌面+回复文本
- "[截屏]好的，我这就截个屏给你看看" → 执行截屏（会发送图片）+回复文本
- "[启动工作流:帮我打开微信]好的，我来帮你规划并执行这个任务" → 启动多步骤工作流
注意：格式完全匹配，参数完整，必须同时回复文本内容，不要只执行功能不回复！`;
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

【核心工具】（read/grep/write/run）
- [读取:文件路径] - 读取文件（工作流中会自动存笔记）
- [搜索:关键词:文件路径(可选)] - 搜索文本（工作流中会自动存笔记）
- [写入:文件路径:内容] - 写入文件
- [执行:命令] - 执行命令
- [笔记:内容] - 记录笔记（仅在工作流中可用）

【Excel操作】
- [生成Excel:文件名:JSON数组] - 创建Excel，数据必须是JSON数组格式
- 示例：[{"列1":"值1","列2":"值2"},{"列1":"值3","列2":"值4"}]

【工作流笔记】
- read和grep的结果会自动存到笔记
- 后续步骤可通过"工作流笔记"查看之前步骤的结果
- 使用[笔记:内容]手动记录信息
   ${fileContext ? fileContext : ''}

【时间】
${now}

${isMaster ? '【权限】\n你拥有主人权限，可以执行所有系统操作。\n\n' : ''}${functionsPrompt ? `${functionsPrompt}\n\n` : ''}【规则】
1. 执行功能时必须回复文本内容，不要只执行不回复
2. 优先使用功能函数执行操作
3. 文件操作默认在工作区进行
4. 如果找到文件内容，请在回复中直接告知用户内容`;
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
      }).catch(() => {});
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
    const decision = await this.workflowManager.decideWorkflowMode(e, goal);
    const todos = decision.todos.length > 0 
      ? decision.todos 
      : await this.workflowManager.generateInitialTodos(goal);
    return await this.workflowManager.createWorkflow(e, goal, todos);
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
