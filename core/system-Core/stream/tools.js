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
 * 
 * 功能分类：
 * - MCP工具（返回JSON）：read（读取文件）、grep（搜索文本）
 * - Call Function（执行操作）：write（写入文件）、run（执行命令）、note（记录笔记）
 * 
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
  }

  registerAllFunctions() {
    // MCP工具：读取文件（返回JSON结果）
    this.registerMCPTool('read', {
      description: '读取文件内容，返回文件路径和内容',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件路径，例如：易忘信息.txt'
          }
        },
        required: ['filePath']
      },
      handler: async (args = {}, context = {}) => {
        const { filePath } = args;
        if (!filePath) {
          return { success: false, error: '文件路径不能为空' };
        }

        let result = await this.tools.readFile(filePath);
        
        if (!result.success) {
          result = await this.trySearchAndReadFile(filePath);
        }

        if (result.success) {
          // 存储到上下文
          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.fileContent = result.content;
            context.stream.context.filePath = result.path;
            context.stream.context.fileName = path.basename(result.path);
            context.stream.context.fileSearchResult = {
              found: true,
              fileName: path.basename(result.path),
              path: result.path,
              content: result.content
            };
          }

          return {
            success: true,
            data: {
              filePath: result.path,
              fileName: path.basename(result.path),
              content: result.content,
              size: result.content.length
            }
          };
        }
        
        const error = result.error || `未找到文件: ${filePath}`;
        if (context.stream) {
          context.stream.context = context.stream.context || {};
          context.stream.context.fileError = error;
          context.stream.context.fileSearchResult = {
            found: false,
            fileName: filePath,
            path: null,
            error
          };
        }
        return { success: false, error };
      },
      enabled: true
    });

    // MCP工具：搜索文本（返回JSON结果）
    this.registerMCPTool('grep', {
      description: '在文件中搜索文本，返回匹配结果',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '搜索关键词'
          },
          filePath: {
            type: 'string',
            description: '文件路径（可选），如果不指定则搜索所有文件'
          }
        },
        required: ['pattern']
      },
      handler: async (args = {}, context = {}) => {
        const { pattern, filePath } = args;
        if (!pattern) {
          return { success: false, error: '搜索关键词不能为空' };
        }

        const result = await this.tools.grep(pattern, filePath, {
          caseSensitive: false,
          lineNumbers: true,
          maxResults: 50
        });

        if (result.success) {
          // 存储到上下文
          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.grepResults = result.matches;
            context.stream.context.grepPattern = pattern;
          }

          return {
            success: true,
            data: {
              pattern,
              filePath: filePath || null,
              matches: result.matches,
              count: result.matches.length
            }
          };
        }
        
        if (context.stream) {
          context.stream.context = context.stream.context || {};
          context.stream.context.grepError = `搜索失败: ${pattern}`;
        }
        return { success: false, error: `搜索失败: ${pattern}` };
      },
      enabled: true
    });

    // Call Function：写入文件（供工具/内部调用）
    this.registerFunction('write', {
      description: '写入文件',
      handler: async (params = {}, context = {}) => {
        const { filePath, content } = params;
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

    // Call Function：执行命令（供工具/内部调用）
    this.registerFunction('run', {
      description: '执行命令',
      handler: async (params = {}, context = {}) => {
        if (!IS_WINDOWS) {
          context.commandError = 'run命令仅在Windows上支持';
          return;
        }

        const { command } = params;
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
   * 格式化搜索匹配结果
   */
  formatGrepMatches(matches) {
    if (matches.length === 0) return '未找到匹配项';
    return matches.slice(0, 20).map(m => `${m.file}:${m.line}: ${m.content}`).join('\n');
  }

  /**
   * 处理写入成功
   */
  async handleWriteSuccess(result, context) {
    context.writeFileResult = { success: true, path: result.path };
  }

  /**
   * 处理写入失败
   */
  async handleWriteFailure(filePath, result, context) {
    context.writeFileError = result.error;
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
  }

  /**
   * 处理命令执行失败
   */
  async handleCommandFailure(command, err, context) {
    context.commandError = err.message;
    context.commandSuccess = false;
    context.commandStderr = err.stderr || '';
  }

  buildSystemPrompt(context) {
    return `【基础工具说明】
你具备写入文件(write)、执行命令(run)、记录笔记(note)等能力。
这些能力会在需要时通过系统的工具调用机制自动触发。

【能力提示】
- 写入文件：根据上下文需要，把内容写入到指定文件
- 执行命令：在工作区执行合适的命令（注意安全和权限）
- 记录笔记：在复杂任务中，把阶段性结论或关键信息记录下来`;
  }
}


