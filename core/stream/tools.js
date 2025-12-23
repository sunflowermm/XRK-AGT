import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import path from 'path';
import os from 'os';
import { BaseTools } from '#utils/base-tools.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const IS_WINDOWS = process.platform === 'win32';

/**
 * 基础工具工作流
 * 提供read/grep/write/run四大核心工具
 * 这些是智能体的基础武器，所有工作流都可以使用
 */
export default class ToolsStream extends AIStream {
  constructor() {
    super({
      name: 'tools',
      description: '基础工具工作流（read/grep/write/run）',
      version: '1.0.0',
      author: 'XRK',
      priority: 200, // 高优先级，基础工具
      config: {
        enabled: true,
        temperature: 0.3,
        maxTokens: 2000,
        topP: 0.9
      }
    });

    this.workspace = IS_WINDOWS 
      ? path.join(os.homedir(), 'Desktop')
      : path.join(os.homedir(), 'Desktop');
    
    this.tools = new BaseTools(this.workspace);
  }

  async init() {
    await super.init();
    this.registerAllFunctions();
    BotUtil.makeLog('info', `[${this.name}] 基础工具工作流已初始化，注册了 ${this.functions.size} 个函数`, 'ToolsStream');
    BotUtil.makeLog('info', `[${this.name}] 函数列表: ${Array.from(this.functions.keys()).join(', ')}`, 'ToolsStream');
  }

  registerAllFunctions() {
    // 1. READ - 读取文件
    this.registerFunction('read', {
      description: '读取文件内容',
      prompt: `[读取:文件路径] - 读取文件内容，例如：[读取:易忘信息.txt]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[(?:读取|read):([^\]]+)\]/gi;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const filePath = (match[1] || '').trim();
          if (filePath) {
            functions.push({ type: 'read', params: { filePath } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        const filePath = params?.filePath;
        if (!filePath) return;

        let result = await this.tools.readFile(filePath);
        
        if (!result.success) {
          result = await this.trySearchAndReadFile(filePath);
        }

        if (result.success) {
          await this.handleReadSuccess(result, context);
        } else {
          await this.handleReadFailure(filePath, result, context);
        }
      },
      enabled: true
    });

    // 2. GREP - 搜索文本
    this.registerFunction('grep', {
      description: '在文件中搜索文本',
      prompt: `[搜索:关键词:文件路径(可选)] - 搜索文本，例如：[搜索:错误:app.log] 或 [搜索:错误]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[(?:搜索|grep):([^:]+)(?::([^\]]+))?\]/gi;
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
          await this.handleGrepSuccess(result, pattern, filePath, context);
        } else {
          await this.handleGrepFailure(pattern, context);
        }
      },
      enabled: true
    });

    // 3. WRITE - 写入文件
    this.registerFunction('write', {
      description: '写入文件',
      prompt: `[写入:文件路径:内容] - 写入文件，例如：[写入:test.txt:这是内容]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[(?:写入|write):([^:]+):([^\]]+)\]/g;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const filePath = (match[1] || '').trim();
          const content = (match[2] || '').trim();
          if (filePath && content) {
            functions.push({ type: 'write', params: { filePath, content } });
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
          await this.handleWriteSuccess(result, context);
        } else {
          await this.handleWriteFailure(filePath, result, context);
        }
      },
      enabled: true
    });

    // 4. RUN - 执行命令
    this.registerFunction('run', {
      description: '执行命令',
      prompt: `[执行:命令] - 执行命令，例如：[执行:ls -la] 或 [执行:Get-ChildItem]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[(?:执行|run):([^\]]+)\]/gi;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const command = (match[1] || '').trim();
          if (command) {
            functions.push({ type: 'run', params: { command } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (!IS_WINDOWS) {
          context.commandError = 'run命令仅在Windows上支持';
          return;
        }

        const command = params?.command;
        if (!command) return;

        try {
          const output = await this.executeCommand(command);
          await this.handleCommandSuccess(command, output, context);
        } catch (err) {
          await this.handleCommandFailure(command, err, context);
        }
      },
      enabled: true
    });

    // 5. NOTE - 记录笔记（工作流专用）
    this.registerFunction('note', {
      description: '记录笔记到工作流',
      prompt: `[笔记:内容] - 记录笔记到工作流，例如：[笔记:重要信息]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const reg = /\[(?:笔记|note):([^\]]+)\]/gi;
        let match;

        while ((match = reg.exec(text)) !== null) {
          const content = (match[1] || '').trim();
          if (content && context.workflowId) {
            functions.push({ type: 'note', params: { content } });
          }
        }

        if (functions.length > 0) {
          cleanText = text.replace(reg, '').trim();
        }

        return { functions, cleanText };
      },
      handler: async (params, context) => {
        const content = params?.content;
        if (!content || !context.workflowId) return;

        await this.storeNote(context.workflowId, content, 'note', true);
        context.noteStored = true;
      },
      enabled: true
    });
  }

  /**
   * 尝试搜索并读取文件
   */
  async trySearchAndReadFile(filePath) {
    const searchResults = await this.tools.searchFiles(path.basename(filePath), {
      maxDepth: 2,
      fileExtensions: null
    });
    
    if (searchResults.length === 0) {
      return { success: false, error: `未找到文件: ${filePath}` };
    }
    
    return await this.tools.readFile(searchResults[0]);
  }

  /**
   * 处理读取成功
   */
  async handleReadSuccess(result, context) {
    const fileName = path.basename(result.path);
    
    context.fileContent = result.content;
    context.filePath = result.path;
    context.fileName = fileName;
    context.fileSearchResult = {
      found: true,
      fileName,
      path: result.path,
      content: result.content
    };
    
    if (!context.workflowId) return;
    
    const noteContent = `【文件读取结果】\n已读取文件：${fileName}\n文件路径：${result.path}\n\n【完整文件内容】\n${result.content}`;
    await this.storeNote(context.workflowId, noteContent, 'read', true);
  }

  /**
   * 处理读取失败
   */
  async handleReadFailure(filePath, result, context) {
    const error = result.error || `未找到文件: ${filePath}`;
    
    context.fileError = error;
    context.fileSearchResult = {
      found: false,
      fileName: filePath,
      path: null,
      error: error
    };
    
    if (!context.workflowId) return;
    
    await this.storeNote(context.workflowId, `【文件读取失败】\n文件：${filePath}\n错误：${error}`, 'read', true);
  }

  /**
   * 处理搜索成功
   */
  async handleGrepSuccess(result, pattern, filePath, context) {
    context.grepResults = result.matches;
    context.grepPattern = pattern;
    
    if (!context.workflowId) return;
    
    const matchesText = this.formatGrepMatches(result.matches);
    const noteContent = `【搜索结果】\n关键词：${pattern}\n${filePath ? `文件：${filePath}\n` : ''}找到 ${result.matches.length} 个匹配项：\n${matchesText}${result.matches.length > 20 ? '\n...(结果已截断)' : ''}`;
    await this.storeNote(context.workflowId, noteContent, 'grep', true);
  }

  /**
   * 格式化搜索匹配结果
   */
  formatGrepMatches(matches) {
    if (matches.length === 0) return '未找到匹配项';
    return matches.slice(0, 20).map(m => `${m.file}:${m.line}: ${m.content}`).join('\n');
  }

  /**
   * 处理搜索失败
   */
  async handleGrepFailure(pattern, context) {
    context.grepError = `搜索失败: ${pattern}`;
    
    if (!context.workflowId) return;
    
    await this.storeNote(context.workflowId, `【搜索失败】\n关键词：${pattern}\n错误：搜索失败`, 'grep', true);
  }

  /**
   * 处理写入成功
   */
  async handleWriteSuccess(result, context) {
    context.writeFileResult = { success: true, path: result.path };
    
    if (!context.workflowId) return;
    
    await this.storeNote(context.workflowId, `【文件写入成功】\n文件：${result.path}`, 'write', true);
  }

  /**
   * 处理写入失败
   */
  async handleWriteFailure(filePath, result, context) {
    context.writeFileError = result.error;
    
    if (!context.workflowId) return;
    
    await this.storeNote(context.workflowId, `【文件写入失败】\n文件：${filePath}\n错误：${result.error}`, 'write', true);
  }

  /**
   * 执行命令
   */
  async executeCommand(command) {
    const workspace = this.workspace;
    const fullCommand = this.buildFullCommand(command, workspace);
    
    const { stdout } = await execAsync(fullCommand, {
      maxBuffer: 10 * 1024 * 1024,
      cwd: workspace,
      shell: IS_WINDOWS ? 'cmd.exe' : undefined
    });
    
    return (stdout || '').trim();
  }

  /**
   * 构建完整命令
   */
  buildFullCommand(command, workspace) {
    // 检测是否为PowerShell命令
    const isPowerShellCmd = /^(Get-|Set-|New-|Remove-|Test-|Invoke-|Start-|Stop-)/i.test(command);
    
    if (IS_WINDOWS) {
      if (isPowerShellCmd) {
        // PowerShell命令需要用powershell执行
        return `powershell -NoProfile -Command "Set-Location '${workspace}'; ${command.replace(/"/g, '`"')}"`;
      }
      // CMD命令
      return `cd /d "${workspace}" && ${command}`;
    }
    
    return `cd "${workspace}" && ${command}`;
  }

  /**
   * 处理命令执行成功
   */
  async handleCommandSuccess(command, output, context) {
    context.commandOutput = output;
    context.commandSuccess = true;
    
    if (!context.workflowId) return;
    
    const truncatedOutput = output.length > 1000 ? output.slice(0, 1000) + '...' : output;
    await this.storeNote(context.workflowId, `【命令执行成功】\n命令：${command}\n输出：${truncatedOutput}`, 'run', true);
  }

  /**
   * 处理命令执行失败
   */
  async handleCommandFailure(command, err, context) {
    context.commandError = err.message;
    context.commandSuccess = false;
    context.commandStderr = err.stderr || '';
    
    if (!context.workflowId) return;
    
    await this.storeNote(context.workflowId, `【命令执行失败】\n命令：${command}\n错误：${err.message}`, 'run', true);
  }

  buildSystemPrompt(context) {
    return `【基础工具工作流】
提供read/grep/write/run四大核心工具。

【可用命令】
1. [读取:文件路径] - 读取文件内容
2. [搜索:关键词:文件路径(可选)] - 搜索文本
3. [写入:文件路径:内容] - 写入文件
4. [执行:命令] - 执行命令
5. [笔记:内容] - 记录笔记（仅在工作流中可用）

【工作流笔记】
- read和grep的结果会自动存到笔记
- 后续步骤可通过笔记查看之前的结果
- 使用[笔记:内容]手动记录信息`;
  }
}


