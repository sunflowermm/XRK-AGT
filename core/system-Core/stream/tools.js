import AIStream from '#infrastructure/aistream/aistream.js';
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
 * 所有功能都通过 MCP 工具提供：
 * - read（读取文件）
 * - grep（搜索文本）
 * - write（写入文件）
 * - run（执行命令）
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

    // MCP工具：写入文件
    this.registerMCPTool('write', {
      description: '写入文件内容',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件路径'
          },
          content: {
            type: 'string',
            description: '文件内容'
          }
        },
        required: ['filePath', 'content']
      },
      handler: async (args = {}, context = {}) => {
        const { filePath, content } = args;
        if (!filePath || !content) {
          return { success: false, error: '文件路径和内容不能为空' };
        }

        const result = await this.tools.writeFile(filePath, content);
        
        if (result.success) {
          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.writeFileResult = { success: true, path: result.path };
          }
          return {
            success: true,
            data: {
              filePath: result.path,
              message: '文件写入成功'
            }
          };
        } else {
          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.writeFileError = result.error;
          }
          return { success: false, error: result.error };
        }
      },
      enabled: true
    });

    // MCP工具：执行命令
    this.registerMCPTool('run', {
      description: '执行命令（工作区：桌面）',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的命令'
          }
        },
        required: ['command']
      },
      handler: async (args = {}, context = {}) => {
        if (!IS_WINDOWS) {
          return { success: false, error: 'run命令仅在Windows上支持' };
        }

        const { command } = args;
        if (!command) {
          return { success: false, error: '命令不能为空' };
        }

        try {
          const output = await this.executeCommand(command);
          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.commandOutput = output;
            context.stream.context.commandSuccess = true;
          }
          return {
            success: true,
            data: {
              command,
              output,
              message: '命令执行成功'
            }
          };
        } catch (err) {
          if (context.stream) {
            context.stream.context = context.stream.context || {};
            context.stream.context.commandError = err.message;
            context.stream.context.commandSuccess = false;
            context.stream.context.commandStderr = err.stderr || '';
          }
          return { success: false, error: err.message, stderr: err.stderr || '' };
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

  buildSystemPrompt(_context) {
    return `【基础工具说明】
所有功能都通过MCP工具调用协议提供，包括：
- read：读取文件内容
- grep：在文件中搜索文本
- write：写入文件内容
- run：执行命令（工作区：桌面）`;
  }
}


