import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { BaseTools } from '../tools/base-tools.js';

// 仅在需要的平台上做判断，避免无意义的常量
const IS_WINDOWS = process.platform === 'win32';

const execCommand = (command, options = {}) => {
  return new Promise((resolve, reject) => {
    exec(command, options, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
};

const execCommandWithOutput = (command, options = {}) => {
  return new Promise((resolve, reject) => {
    exec(command, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        // 将 stderr 附加到 error 对象以便调试
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
  static initialized = false;

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

    this.registerAllFunctions();
    
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
    
    DesktopStream.initialized = true;
    BotUtil.makeLog('info', `[${this.name}] 工作流已初始化`, 'DesktopStream');
  }

  async handleError(context, error, operation) {
    BotUtil.makeLog('error', `[desktop] ${operation}失败: ${error.message}`, 'DesktopStream');
    context.lastError = { operation, message: error.message };
  }

  async requireWindows(context, operation) {
    if (!IS_WINDOWS) {
      context.windowsOnly = true;
      context.operation = operation;
      return false;
    }
    return true;
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
        if (!(await this.requireWindows(context, '回桌面功能'))) return;

        try {
          await execCommand('powershell -Command "(New-Object -ComObject shell.application).MinimizeAll()"');
        } catch (err) {
          await this.handleError(context, err, '回桌面操作');
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
        if (!(await this.requireWindows(context, '打开系统工具功能'))) return;

        const tool = params?.tool;
        if (!tool) return;

        const toolNames = { notepad: '记事本', calc: '计算器', taskmgr: '任务管理器' };
        
        try {
          await execCommand(`start "" ${tool}`, { shell: 'cmd.exe' });
          context.executedTool = toolNames[tool] || '应用';
        } catch (err) {
          await this.handleError(context, err, '打开系统工具');
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
        if (!(await this.requireWindows(context, '截屏功能'))) return;
    
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const screenshotDir = path.join(paths.trash, 'screenshot');
          await fs.mkdir(screenshotDir, { recursive: true });
          
          const filename = `screenshot_${timestamp}.png`;
          const screenshotPath = path.join(screenshotDir, filename);
          const absolutePath = path.resolve(screenshotPath);
          const pathBase64 = Buffer.from(absolutePath, 'utf16le').toString('base64');
          
          const psScriptPath = path.join(screenshotDir, `_cap_${Date.now()}.ps1`);
          const psScriptContent = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    
    $pathBytes = [System.Convert]::FromBase64String('${pathBase64}')
    $filePath = [System.Text.Encoding]::Unicode.GetString($pathBytes)
    
    $dir = [System.IO.Path]::GetDirectoryName($filePath)
    if (-not [System.IO.Directory]::Exists($dir)) {
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    }
    
    $screens = [System.Windows.Forms.Screen]::AllScreens
    
    if ($null -eq $screens -or $screens.Count -eq 0) {
        Write-Host "ERROR: Cannot get any screen"
        exit 1
    }
    
    $minX = [int]::MaxValue
    $minY = [int]::MaxValue
    $maxX = [int]::MinValue
    $maxY = [int]::MinValue
    
    foreach ($screen in $screens) {
        $bounds = $screen.Bounds
        if ($bounds.Left -lt $minX) { $minX = $bounds.Left }
        if ($bounds.Top -lt $minY) { $minY = $bounds.Top }
        if ($bounds.Right -gt $maxX) { $maxX = $bounds.Right }
        if ($bounds.Bottom -gt $maxY) { $maxY = $bounds.Bottom }
    }
    
    $totalWidth = $maxX - $minX
    $totalHeight = $maxY - $minY
    
    if ($totalWidth -le 0 -or $totalHeight -le 0) {
        Write-Host "ERROR: Invalid screen dimensions: $totalWidth x $totalHeight"
        exit 1
    }
    
    $bitmap = New-Object System.Drawing.Bitmap($totalWidth, $totalHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    if ($null -eq $bitmap) {
        Write-Host "ERROR: Failed to create bitmap"
        exit 1
    }

    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    if ($null -eq $graphics) {
        Write-Host "ERROR: Failed to create graphics from bitmap"
        $bitmap.Dispose()
        exit 1
    }
    
    $graphics.CopyFromScreen($minX, $minY, 0, 0, (New-Object System.Drawing.Size($totalWidth, $totalHeight)), [System.Drawing.CopyPixelOperation]::SourceCopy)
    
    $bitmap.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $graphics.Dispose()
    $bitmap.Dispose()
    
    if ([System.IO.File]::Exists($filePath)) {
        $fileInfo = Get-Item -LiteralPath $filePath
        $size = $fileInfo.Length
        if ($size -gt 0) {
            Write-Host "SUCCESS:$size"
        } else {
            Write-Host "ERROR: File size is 0"
            exit 1
        }
    } else {
        Write-Host "ERROR: File not created"
        exit 1
    }
    `;
          
          await fs.writeFile(psScriptPath, psScriptContent, 'utf8');
          
          let output = '';
          const { spawn } = await import('child_process');
          output = await new Promise((resolve, reject) => {
            const ps = spawn('powershell', [
              '-NoProfile',
              '-ExecutionPolicy', 'Bypass',
              '-STA',
              '-File', psScriptPath
            ], {
              shell: false,
              windowsHide: true
            });
            
            let stdout = '';
            let stderr = '';
            
            ps.stdout.on('data', (data) => { stdout += data.toString(); });
            ps.stderr.on('data', (data) => { stderr += data.toString(); });
            
            ps.on('close', (code) => {
              if (code !== 0) {
                reject(new Error(`PowerShell 退出码: ${code}。错误: ${stderr || stdout || '未知错误'}`));
              } else {
                resolve(stdout.trim());
              }
            });
            
            ps.on('error', (err) => {
              reject(new Error(`PowerShell 启动失败: ${err.message}`));
            });
          });
          
          // 清理临时脚本
          try { await fs.unlink(psScriptPath); } catch (e) {}
          
          // 检查输出
          if (!output || !output.includes('SUCCESS')) {
            throw new Error(`截屏脚本执行异常。输出: ${output || '(无输出)'}`);
          }
          
          // 等待文件写入完成
          let fileReady = false;
          for (let retry = 0; retry < 10; retry++) {
            await new Promise(resolve => setTimeout(resolve, 200));
            try {
              await fs.access(screenshotPath);
              const stats = await fs.stat(screenshotPath);
              if (stats.size > 0) {
                fileReady = true;
                break;
              }
            } catch (e) {
              // 文件还未生成，继续等待
            }
          }
          
          if (!fileReady) {
            try {
              await fs.access(screenshotPath);
              const stats = await fs.stat(screenshotPath);
              if (stats.size === 0) {
                throw new Error('截屏文件为空');
              }
            } catch (fileErr) {
              throw new Error(`截屏文件未生成或无法访问: ${fileErr.message}。PowerShell 输出: ${output}`);
            }
          }
    
          if (context.e) {
            // 仅发送图片，由 AI 在对话中自然说明，无需额外的“截图成功”提示
            await context.e.reply([
              { type: 'image', data: { file: screenshotPath } }
            ]);
          }
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
        if (!(await this.requireWindows(context, '锁屏功能'))) return;

        try {
          await execCommand('rundll32.exe user32.dll,LockWorkStation');
        } catch (err) {
          await this.handleError(context, err, '锁屏操作');
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
        if (!(await this.requireWindows(context, '系统信息查看'))) return;

        try {
          const cpuOutput = await execCommandWithOutput('wmic cpu get loadpercentage');
          const cpu = cpuOutput.trim().split('\n')[1]?.trim() || '未知';

          const memOutput = await execCommandWithOutput('wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value');
          const free = memOutput.match(/FreePhysicalMemory=(\d+)/)?.[1];
          const total = memOutput.match(/TotalVisibleMemorySize=(\d+)/)?.[1];

          context.systemInfo = {
            cpu: cpu + '%',
            memory: free && total ? {
              usedPercent: ((1 - parseInt(free) / parseInt(total)) * 100).toFixed(1) + '%',
              freeGB: (parseInt(free) / 1024 / 1024).toFixed(2) + 'GB',
              totalGB: (parseInt(total) / 1024 / 1024).toFixed(2) + 'GB'
            } : null
          };
        } catch (err) {
          await this.handleError(context, err, '获取系统信息');
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
          await this.handleError(context, err, '打开网页');
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
        if (!(await this.requireWindows(context, '关机/重启功能'))) return;

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
            await this.handleError(context, err, '电源控制操作');
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
        if (!(await this.requireWindows(context, '创建文件夹功能'))) return;

        const folderName = params?.folderName;
        if (!folderName) return;

        try {
          const workspace = this.getWorkspace();
          const safeName = folderName.replace(/[<>:"/\\|?*]/g, '_');
          const folderPath = path.join(workspace, safeName);
          await execCommand(`powershell -Command "New-Item -Path '${folderPath}' -ItemType Directory -Force"`);
          context.createdFolder = safeName;
          context.createdFolderPath = folderPath;
        } catch (err) {
          await this.handleError(context, err, '创建文件夹');
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
          await this.handleError(context, err, '打开资源管理器');
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
        if (!(await this.requireWindows(context, '磁盘空间查看'))) return;

        try {
          const output = await execCommandWithOutput('wmic logicaldisk get caption,freespace,size /format:csv');
          const lines = output.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
          const disks = [];

          for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 4) {
              const caption = parts[1]?.trim();
              const free = parseInt(parts[2]?.trim());
              const size = parseInt(parts[3]?.trim());

              if (caption && !isNaN(free) && !isNaN(size) && size > 0) {
                const freeGB = (free / 1024 / 1024 / 1024).toFixed(2);
                const totalGB = (size / 1024 / 1024 / 1024).toFixed(2);
                const usedPercent = ((1 - free / size) * 100).toFixed(1);
                disks.push(`${caption} ${usedPercent}% 已用 (${freeGB}GB / ${totalGB}GB 可用)`);
              }
            }
          }

          context.diskSpace = disks.length > 0 ? disks : null;
        } catch (err) {
          await this.handleError(context, err, '获取磁盘空间');
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
        if (!(await this.requireWindows(context, '执行PowerShell命令'))) return;

        const command = params?.command;
        if (!command) return;

        try {
          // 设置工作区为桌面
          const workspace = this.getWorkspace();
          const fullCommand = `cd "${workspace}"; ${command}`;
          
          const output = await execCommandWithOutput(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${fullCommand.replace(/"/g, '\\"')}"`,
            { maxBuffer: 10 * 1024 * 1024, cwd: workspace }
          );
          context.commandOutput = output.trim();
          context.commandSuccess = true;
        } catch (err) {
          context.commandError = err.message;
          context.commandSuccess = false;
          context.commandStderr = err.stderr || '';
          await this.handleError(context, err, '执行PowerShell命令');
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
        if (!(await this.requireWindows(context, '列出桌面文件'))) return;

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
        } catch (err) {
          await this.handleError(context, err, '列出桌面文件');
        }
      },
      enabled: true
    });

    // 统一文件读取工具（使用BaseTools）
    this.registerFunction('read_file', {
      description: '读取文件（优先在工作区查找）',
      prompt: `[读取文件:文件名或路径] - 在工作区查找并读取文件，例如：[读取文件:易忘信息.txt]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[(?:读取文件|读取|查找文件|查找):([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const fileName = (match[1] || '').trim();
          if (fileName) {
            functions.push({ type: 'read_file', params: { fileName } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        const fileName = params?.fileName;
        if (!fileName) return;

        // 先尝试直接读取（完整路径）
        let result = await this.tools.readFile(fileName);
        
        // 如果失败，在工作区搜索文件
        if (!result.success) {
          const searchResults = await this.tools.searchFiles(path.basename(fileName), {
            maxDepth: 2,
            fileExtensions: null
          });
          
          if (searchResults.length > 0) {
            result = await this.tools.readFile(searchResults[0]);
          }
        }

        if (result.success) {
          context.fileSearchResult = { found: true, fileName: path.basename(result.path), path: result.path, content: result.content };
          context.fileContent = result.content;
        } else {
          context.fileSearchResult = { found: false, fileName };
          context.fileError = result.error || `未找到文件: ${fileName}`;
        }
      },
      enabled: true
    });

    // Grep搜索工具
    this.registerFunction('grep', {
      description: '在文件中搜索文本',
      prompt: `[搜索文本:关键词:文件路径(可选)] - 在文件中搜索文本，例如：[搜索文本:错误:app.log] 或 [搜索文本:错误]（在工作区搜索）`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[搜索文本:([^:]+)(?::([^\]]+))?\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const pattern = (match[1] || '').trim();
          const filePath = match[2] ? match[2].trim() : null;
          if (pattern) {
            functions.push({ type: 'grep', params: { pattern, filePath } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        const { pattern, filePath } = params || {};
        if (!pattern) return;

        const result = await this.tools.grep(pattern, filePath, {
          caseSensitive: false,
          lineNumbers: true,
          maxResults: 50
        });

        if (result.success) {
          context.grepResults = result.matches;
          context.grepPattern = pattern;
        } else {
          context.grepError = `搜索失败: ${pattern}`;
        }
      },
      enabled: true
    });

    // 写入文件工具
    this.registerFunction('write_file', {
      description: '写入文件',
      prompt: `[写入文件:文件路径:内容] - 写入文件，例如：[写入文件:test.txt:这是内容]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[写入文件:([^:]+):([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const filePath = (match[1] || '').trim();
          const content = (match[2] || '').trim();
          if (filePath && content) {
            functions.push({ type: 'write_file', params: { filePath, content } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        const { filePath, content } = params || {};
        if (!filePath || !content) return;

        const result = await this.tools.writeFile(filePath, content);
        
        if (result.success) {
          context.writeFileResult = { success: true, path: result.path };
        } else {
          context.writeFileError = result.error;
        }
      },
      enabled: true
    });

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
        if (!(await this.requireWindows(context, '打开软件'))) return;

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
            // 使用快捷方式打开
            await execCommand(`powershell -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}'); Start-Process $shortcut.TargetPath"`);
          } else {
            // 尝试直接启动程序
            await execCommand(`start "" "${appName}"`, { shell: 'cmd.exe' });
          }

          context.openedApp = appName;
        } catch (err) {
          await this.handleError(context, err, '打开软件');
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
        if (!(await this.requireWindows(context, '生成Word文档'))) return;

        const fileName = params?.fileName;
        const content = params?.content;
        if (!fileName || !content) return;

        try {
          const workspace = this.getWorkspace();
          const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
          const filePath = path.join(workspace, safeFileName.endsWith('.docx') ? safeFileName : `${safeFileName}.docx`);

          // 使用PowerShell创建Word文档
          const psScript = `
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Add()
$doc.Content.Text = @"
${content.replace(/"/g, '`"').replace(/\$/g, '`$')}
"@
$doc.SaveAs([ref]"${filePath.replace(/\\/g, '\\\\')}")
$doc.Close()
$word.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
          `;

          await execCommandWithOutput(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`);
          context.createdWordDoc = filePath;
        } catch (err) {
          await this.handleError(context, err, '生成Word文档');
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
        const reg = /\[生成Excel:([^:]+):([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const fileName = (match[1] || '').trim();
          const dataStr = (match[2] || '').trim();
          if (fileName && dataStr) {
            try {
              // 只接受JSON格式
              const data = JSON.parse(dataStr);
              if (!Array.isArray(data)) {
                throw new Error('数据必须是JSON数组格式');
              }
              functions.push({ type: 'create_excel_document', params: { fileName, data } });
            } catch (e) {
              context.excelError = `Excel数据格式错误: ${e.message}，必须是JSON数组格式`;
            }
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (!(await this.requireWindows(context, '生成Excel文档'))) return;

        const fileName = params?.fileName;
        const data = params?.data;
        if (!fileName || !data) return;

        if (!Array.isArray(data)) {
          context.excelError = '数据必须是数组格式';
          return;
        }

        try {
          // 使用工作区路径（桌面）
          const workspace = this.getWorkspace();
          const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
          const filePath = path.join(workspace, safeFileName.endsWith('.xlsx') ? safeFileName : `${safeFileName}.xlsx`);

          const dataJson = JSON.stringify(data);
          const psScript = `
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $true
$workbook = $excel.Workbooks.Add()
$worksheet = $workbook.Worksheets.Item(1)

$data = @'
${dataJson.replace(/"/g, '`"').replace(/\$/g, '`$')}
'@ | ConvertFrom-Json

if ($data -is [Array] -and $data.Count -gt 0) {
    $headers = $data[0].PSObject.Properties.Name
    for ($i = 0; $i -lt $headers.Count; $i++) {
        $cell = $worksheet.Cells.Item(1, $i + 1)
        $cell.Value2 = $headers[$i]
        $cell.Font.Bold = $true
        $cell.Interior.Color = [System.Drawing.ColorTranslator]::ToOle([System.Drawing.Color]::LightGray)
    }
    for ($row = 0; $row -lt $data.Count; $row++) {
        for ($col = 0; $col -lt $headers.Count; $col++) {
            $worksheet.Cells.Item($row + 2, $col + 1).Value2 = $data[$row].($headers[$col])
        }
    }
    $worksheet.Columns.AutoFit() | Out-Null
} else {
    $worksheet.Cells.Item(1, 1).Value2 = "数据为空"
}

$workbook.SaveAs("${filePath.replace(/\\/g, '\\\\')}")
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
          `;

          const result = await this.tools.executeCommand(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
            { registerProcess: true }
          );

          if (result.success) {
            context.createdExcelDoc = filePath;
            context.excelPath = filePath; // 记录完整路径供AI使用
          } else {
            throw new Error(result.error || 'Excel生成失败');
          }
        } catch (err) {
          await this.handleError(context, err, '生成Excel文档');
          context.excelError = err.message;
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
        if (!goal) return;

        try {
          const planningMessages = [
            {
              role: 'system',
              content: `你是一个任务规划助手。用户提出了一个目标，你需要将其分解为具体的执行步骤。

【目标】
${goal}

【要求】
1. 将目标分解为3-5个具体的执行步骤
2. 每个步骤应该是可执行的、清晰的操作
3. 步骤之间应该有逻辑顺序
4. 输出格式：每行一个步骤，用数字编号

【示例】
目标：帮我打开微信并发送消息给张三
步骤：
1. 查看桌面文件，找到微信快捷方式
2. 打开微信软件
3. 等待微信启动完成
4. 查找联系人张三
5. 发送消息给张三`
            },
            { role: 'user', content: `请为以下目标规划执行步骤：\n${goal}` }
          ];

          const planningResponse = await this.callAI(planningMessages, this.config);
          const todos = this.parsePlanningResponse(planningResponse, goal);
          
          if (this.workflowManager) {
            const workflowId = await this.workflowManager.createWorkflow(context.e, goal, todos);
            context.workflowId = workflowId;
            await context.e?.reply(`工作流已启动！\n目标：${goal}\n步骤数：${todos.length}\n工作流ID：${workflowId}`);
          } else {
            await context.e?.reply(`TODO工作流插件未加载，无法启动多步骤工作流`);
          }
        } catch (err) {
          await this.handleError(context, err, '启动工作流');
        }
      },
      enabled: true
    });
  }

  parsePlanningResponse(response, goal) {
    const todos = [];
    const lines = response.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      const stepMatch = trimmed.match(/^\d+[\.、]\s*(.+)$/);
      if (stepMatch) {
        todos.push(stepMatch[1].trim());
      } else if (trimmed && !trimmed.startsWith('步骤') && !trimmed.startsWith('目标')) {
        if (trimmed.length > 5 && trimmed.length < 100) {
          todos.push(trimmed);
        }
      }
    }

    if (todos.length === 0) {
      todos.push(`分析目标：${goal}`, '执行必要操作', '验证执行结果');
    }

    return todos;
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
      '你是一个贴心智能的桌面助手，热情友好，会主动关心用户。执行功能时不只是简单操作，还会多说几句作为"捧哏"——可以温馨提醒、适当调侃、给出建议或表达关心，让对话更生动有趣。';
    const functionsPrompt = this.buildFunctionsPrompt();
    const now = new Date().toLocaleString('zh-CN');
    const isMaster = e?.isMaster === true;
    const workspace = this.getWorkspace();
    
    // 如果有文件查找结果，添加到系统提示中
    let fileContext = '';
    if (context.fileSearchResult?.found && context.fileContent) {
      fileContext = `\n\n【已找到文件内容】\n文件名：${context.fileSearchResult.fileName}\n文件内容如下：\n${context.fileContent.substring(0, 2000)}${context.fileContent.length > 2000 ? '\n...(内容已截断)' : ''}\n\n请在回复中直接告知用户上述文件内容。`;
    } else if (context.fileSearchResult?.found === false) {
      fileContext = `\n\n【文件查找结果】\n未找到文件：${context.fileError || '文件不存在'}\n请告知用户文件未找到。`;
    }

    return `【人设】
${persona}

【工作区】
你的工作区是桌面目录：${workspace}
- 所有文件操作默认在桌面进行
- 查找文件时优先在桌面查找，使用[查找文件:文件名]命令
- 创建文件时默认保存到桌面

【工具使用指南】
1. 文件操作（基础工具）：
   - [读取文件:文件名] - 在工作区（桌面）查找并读取文件，读取后文件内容会提供给你
   - [写入文件:文件路径:内容] - 写入文件到工作区
   - [搜索文本:关键词:文件路径(可选)] - 在文件中搜索文本（grep功能）

2. Excel操作（严格格式要求）：
   - [生成Excel:文件名:JSON数组] - 创建Excel表格并保存到桌面，会自动打开
   - **数据格式**：必须是JSON数组，例如：[{"列名1":"值1","列名2":"值2"},{"列名1":"值3","列名2":"值4"}]
   - **重要**：如果你有文本内容，必须先分析文本结构，提取数据，然后手动转换为JSON数组格式
   - **文件位置**：Excel文件会保存到桌面（工作区）

3. 工作流执行流程（多步骤任务）：
   当任务包含多个步骤时（如"读取文件并创建Excel"），系统会自动创建工作流：
   - **步骤1**：读取文件 → 使用[读取文件:文件名]，在笔记中记录文件内容
   - **步骤2**：分析内容 → 查看笔记中的文件内容，分析并提取结构化数据，在笔记中记录JSON数组
   - **步骤3**：创建Excel → 查看笔记中的JSON数组，使用[生成Excel:文件名:JSON数组]
   
4. 工作流笔记机制（关键）：
   - 通过"笔记:"字段记录信息，所有步骤共享
   - **步骤间信息传递**：后续步骤可以通过笔记查看之前步骤的结果
   - **示例**：
     * 步骤1笔记：记录文件完整内容
     * 步骤2笔记：记录分析结果和JSON数组格式的数据
     * 步骤3笔记：记录Excel创建结果

5. 工作区说明：
   - 所有文件操作默认在工作区（桌面）进行
   - 文件查找优先在桌面
   - 创建的文件会保存到桌面
   ${fileContext ? fileContext : ''}

【时间】
${now}

${isMaster ? '【权限】\n你拥有主人权限，可以执行所有系统操作。\n\n' : ''}${functionsPrompt ? `${functionsPrompt}\n\n` : ''}【规则】
1. 执行功能时必须回复文本内容，不要只执行不回复
2. 语气自然友好，可以多说几句作为捧哏、提醒或告诫
3. 优先使用功能函数执行操作，但一定要在回复中自然表达
4. 文件操作默认在桌面工作区进行
5. 查找文件时直接使用[查找文件:文件名]命令，不需要创建工作流
6. 如果找到文件内容，请在回复中直接告知用户内容，不要只说"已找到文件"
7. 如果PowerShell命令执行失败，会在笔记中记录错误，下次调用AI时会看到错误信息并重试
8. 简洁准确但不失人情味，让用户感受到你的关心`;
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

  async cleanup() {
    // 清理进程监控
    if (this.processCleanupInterval) {
      clearInterval(this.processCleanupInterval);
      this.processCleanupInterval = null;
    }
    
    // 清理已注册的进程
    if (this.tools) {
      await this.tools.cleanupProcesses();
    }
    
    await super.cleanup();
    DesktopStream.initialized = false;
  }
}
