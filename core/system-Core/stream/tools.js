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
 * - write（写入文件，覆盖）
 * - create_file（创建新文件）
 * - delete_file（删除文件）
 * - modify_file（修改文件，支持替换/追加/插入）
 * - list_files（列出目录文件）
 * - run（执行命令）
 */
export default class ToolsStream extends AIStream {
  constructor() {
    super({
      name: 'tools',
      description: '基础工具工作流（read/grep/write/run）',
      version: '1.0.5',
      author: 'XRK',
      priority: 200, // 高优先级，基础工具
      config: {
        enabled: true,
        temperature: 0.3,
        maxTokens: 2000,
        topP: 0.9
      }
    });

    this.workspace = path.join(os.homedir(), 'Desktop');
    
    this.tools = new BaseTools(this.workspace);
  }

  async init() {
    await super.init();
    this.registerAllFunctions();
  }

  registerAllFunctions() {
    this.registerMCPTool('read', {
      description: '读取文件内容。支持相对路径和绝对路径，文件不存在时自动在工作区搜索。',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件路径（相对或绝对路径）'
          }
        },
        required: ['filePath']
      },
      handler: async (args = {}, context = {}) => {
        const { filePath } = args;
        if (!filePath) return { success: false, error: '文件路径不能为空' };

        let result = await this.tools.readFile(filePath);
        
        if (!result.success) {
          result = await this.trySearchAndReadFile(filePath);
        }

        if (result.success) {
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
        
        return { success: false, error: result.error || `未找到文件: ${filePath}` };
      },
      enabled: true
    });

    this.registerMCPTool('grep', {
      description: '在文件中搜索文本。支持指定文件或工作区所有文件，不区分大小写。',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '搜索关键词'
          },
          filePath: {
            type: 'string',
            description: '文件路径（可选，不指定则搜索所有文件）'
          }
        },
        required: ['pattern']
      },
      handler: async (args = {}, context = {}) => {
        const { pattern, filePath } = args;
        if (!pattern) return { success: false, error: '搜索关键词不能为空' };

        const result = await this.tools.grep(pattern, filePath, {
          caseSensitive: false,
          lineNumbers: true,
          maxResults: 50
        });

        if (result.success) {
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
        
        return { success: false, error: `搜索失败: ${pattern}` };
      },
      enabled: true
    });

    this.registerMCPTool('write', {
      description: '写入文件内容（完全覆盖）。文件不存在时自动创建。如需追加请使用 modify_file。',
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
        if (!filePath) return { success: false, error: '文件路径不能为空' };
        if (content === undefined) return { success: false, error: '文件内容不能为空' };

        const result = await this.tools.writeFile(filePath, content);
        
        if (result.success) {
          return {
            success: true,
            data: {
              filePath: result.path,
              message: '文件写入成功'
            }
          };
        }
        
        return { success: false, error: result.error };
      },
      enabled: true
    });

    this.registerMCPTool('create_file', {
      description: '创建新文件。自动创建不存在的目录，文件已存在时覆盖。',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件路径'
          },
          content: {
            type: 'string',
            description: '初始内容（可选）'
          }
        },
        required: ['filePath']
      },
      handler: async (args = {}, context = {}) => {
        const { filePath, content = '' } = args;
        if (!filePath) return { success: false, error: '文件路径不能为空' };

        const fullPath = this.tools.resolvePath(filePath);
        try {
          const fs = await import('fs/promises');
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf8');
          return {
            success: true,
            data: {
              filePath: fullPath,
              message: '文件创建成功'
            }
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('delete_file', {
      description: '删除文件。此操作不可恢复，请谨慎使用。',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件路径'
          }
        },
        required: ['filePath']
      },
      handler: async (args = {}, context = {}) => {
        const { filePath } = args;
        if (!filePath) return { success: false, error: '文件路径不能为空' };

        const fullPath = this.tools.resolvePath(filePath);
        try {
          const fs = await import('fs/promises');
          await fs.unlink(fullPath);
          return {
            success: true,
            data: {
              filePath: fullPath,
              message: '文件删除成功'
            }
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('modify_file', {
      description: '修改文件内容。支持三种模式：replace（替换全部或指定行）、append（追加到末尾）、prepend（插入到开头）。',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件路径'
          },
          content: {
            type: 'string',
            description: '要添加或替换的内容'
          },
          mode: {
            type: 'string',
            enum: ['replace', 'append', 'prepend'],
            description: '修改模式：replace(替换全部或指定行)、append(追加到末尾)、prepend(插入到开头)',
            default: 'replace'
          },
          lineNumber: {
            type: 'integer',
            description: '行号（仅在replace模式下有效，从1开始）'
          }
        },
        required: ['filePath', 'content']
      },
      handler: async (args = {}, context = {}) => {
        const { filePath, content, mode = 'replace', lineNumber } = args;
        if (!filePath || content === undefined) {
          return { success: false, error: '文件路径和内容不能为空' };
        }

        const fullPath = this.tools.resolvePath(filePath);
        try {
          const fs = await import('fs/promises');
          let fileContent = '';
          
          try {
            fileContent = await fs.readFile(fullPath, 'utf8');
          } catch {
            if (mode === 'replace') {
              fileContent = '';
            } else {
              return { success: false, error: '文件不存在，无法使用append或prepend模式' };
            }
          }

          let newContent = '';
          if (mode === 'replace') {
            if (lineNumber !== undefined && lineNumber > 0) {
              const lines = fileContent.split('\n');
              if (lineNumber <= lines.length) {
                lines[lineNumber - 1] = content;
                newContent = lines.join('\n');
              } else {
                return { success: false, error: `行号 ${lineNumber} 超出文件行数 ${lines.length}` };
              }
            } else {
              newContent = content;
            }
          } else if (mode === 'append') {
            newContent = fileContent + (fileContent && !fileContent.endsWith('\n') ? '\n' : '') + content;
          } else if (mode === 'prepend') {
            newContent = content + (fileContent && !fileContent.startsWith('\n') ? '\n' : '') + fileContent;
          }

          await fs.writeFile(fullPath, newContent, 'utf8');
          return {
            success: true,
            data: {
              filePath: fullPath,
              mode,
              message: `文件${mode === 'replace' ? '替换' : mode === 'append' ? '追加' : '插入'}成功`
            }
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('list_files', {
      description: '列出目录中的文件和子目录。支持过滤文件类型和是否包含隐藏文件，默认列出工作区。',
      inputSchema: {
        type: 'object',
        properties: {
          dirPath: {
            type: 'string',
            description: '目录路径（可选，默认为工作区）'
          },
          includeHidden: {
            type: 'boolean',
            description: '是否包含隐藏文件',
            default: false
          },
          type: {
            type: 'string',
            enum: ['all', 'files', 'dirs'],
            description: '文件类型过滤：all(全部)、files(仅文件)、dirs(仅目录)',
            default: 'all'
          }
        },
        required: []
      },
      handler: async (args = {}, context = {}) => {
        const { dirPath = null, includeHidden = false, type = 'all' } = args;
        const result = await this.tools.listDir(dirPath, { includeHidden, type });
        
        if (result.success) {
          return {
            success: true,
            data: {
              path: result.path,
              items: result.items,
              count: result.items.length
            }
          };
        }
        
        return { success: false, error: result.error };
      },
      enabled: true
    });

    this.registerMCPTool('run', {
      description: '执行系统命令。在工作区目录下执行，支持 Windows CMD 和 PowerShell 命令，仅 Windows 系统支持。',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的命令（CMD 或 PowerShell）'
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
          return {
            success: true,
            data: {
              command,
              output,
              message: '命令执行成功'
            }
          };
        } catch (err) {
          return { success: false, error: err.message, stderr: err.stderr || '' };
        }
      },
      enabled: true
    });

  }

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

  async executeCommand(command) {
    const fullCommand = this.buildFullCommand(command, this.workspace);
    const { stdout } = await execAsync(fullCommand, {
      maxBuffer: 10 * 1024 * 1024,
      cwd: this.workspace,
      shell: IS_WINDOWS ? 'cmd.exe' : undefined
    });
    return (stdout ?? '').trim();
  }

  buildFullCommand(command, workspace) {
    const isPowerShellCmd = /^(Get-|Set-|New-|Remove-|Test-|Invoke-|Start-|Stop-)/i.test(command);
    if (IS_WINDOWS) {
      return isPowerShellCmd
        ? `powershell -NoProfile -Command "Set-Location '${workspace}'; ${command.replace(/"/g, '`"')}"`
        : `cd /d "${workspace}" && ${command}`;
    }
    return `cd "${workspace}" && ${command}`;
  }


  buildSystemPrompt() {
    return `【基础工具说明】
所有功能都通过MCP工具调用协议提供，包括：
- read：读取文件内容
- grep：在文件中搜索文本
- write：写入文件内容（覆盖）
- create_file：创建新文件
- delete_file：删除文件
- modify_file：修改文件内容（支持替换、追加、插入）
- list_files：列出目录中的文件
- run：执行命令（工作区：桌面）`;
  }
}


