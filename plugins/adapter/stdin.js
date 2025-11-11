import { createInterface } from "readline";
import fs from "fs";
import os from "os";
import { exec } from "child_process";
import path from "path";
import { ulid } from "ulid";
import crypto from 'crypto';
import BotUtil from "../../lib/common/util.js";

const tempDir = path.join(process.cwd(), "www", "stdin");
const mediaDir = path.join(process.cwd(), "www", "media");
const pluginsLoader = (await import("../../lib/plugins/loader.js")).default;

// 确保目录存在
for (const dir of [tempDir, mediaDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 定期清理临时文件
setInterval(() => {
  try {
    const now = Date.now();
    for (const dir of [tempDir, mediaDir]) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 3600000) { // 1小时后清理
          fs.unlinkSync(filePath);
          logger.debug(`已清理临时文件: ${file}`);
        }
      });
    }
  } catch (error) {
    logger.error(`清理临时文件错误: ${error.message}`);
  }
}, 3600000);

export class StdinHandler {
  constructor() {
    if (global.stdinHandler) return global.stdinHandler;
    
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: logger.gradient('> ', ['#3494E6', '#3498db', '#00b4d8', '#0077b6', '#023e8a'])
    });

    this.botId = 'stdin';
    this.initStdinBot();
    this.setupListeners();
    this.startImprovedListener();
    global.stdinHandler = this;
  }

  initStdinBot() {
    if (!Bot.stdin) {
      Bot.uin.push(this.botId);
      Bot.stdin = {
        uin: this.botId,
        nickname: 'StdinBot',
        avatar: 'https://q1.qlogo.cn/g?b=qq&s=0&nk=10000001',
        stat: { start_time: Date.now() / 1000 },
        version: { id: 'stdin', name: 'StdinBot', version: '1.0.0' },
        config: { master: true },
        adapter: { id: 'stdin', name: '标准输入适配器' },
        pickUser: (user_id) => Bot.pickFriend(user_id),
        pickFriend: (user_id) => ({
          user_id,
          nickname: user_id,
          sendMsg: async (msg) => this.sendMsg(msg, user_id, { user_id }),
          recallMsg: () => true,
          getAvatarUrl: () => `https://q1.qlogo.cn/g?b=qq&s=0&nk=${user_id}`
        }),
        pickGroup: (group_id) => ({
          group_id,
          group_name: `群${group_id}`,
          sendMsg: async (msg) => this.sendMsg(msg, `群${group_id}`, { group_id }),
          makeForwardMsg: async (forwardMsg) => this.makeForwardMsg(forwardMsg),
          pickMember: (user_id) => ({
            user_id,
            nickname: user_id,
            card: user_id,
            getAvatarUrl: () => `https://q1.qlogo.cn/g?b=qq&s=0&nk=${user_id}`
          })
        }),
        getGroupArray: () => [],
        getFriendArray: () => [],
        fileToUrl: async (filePath, opts = {}) => {
          try {
            // 如果是URL直接返回
            if (typeof filePath === 'string' && filePath.startsWith('http')) {
              return filePath;
            }

            // 获取服务器URL
            const baseUrl = Bot.getServerUrl ? Bot.getServerUrl() : `http://localhost:${Bot.httpPort || 3000}`;
            
            // 处理文件
            const result = await this.processFileToUrl(filePath, baseUrl);
            return result;
          } catch (err) {
            logger.error(`文件转URL失败: ${err.message}`);
            return '';
          }
        }
      };
    }
  }

  /**
   * 将文件转换为URL [API 基础知识和教程 ...](https://apifox.com/apiskills/how-to-convert-image-to-base64-in-nodejs/)
   */
  async processFileToUrl(filePath, baseUrl) {
    try {
      let buffer;
      let fileName;
      let fileExt = 'file';

      // 处理不同类型的输入
      if (Buffer.isBuffer(filePath)) {
        buffer = filePath;
        // 尝试检测文件类型
        const fileType = await BotUtil.fileType({ buffer });
        fileExt = fileType?.type?.ext || 'file';
        fileName = `${ulid()}.${fileExt}`;
      } else if (typeof filePath === 'string') {
        // 检查文件是否存在
        if (fs.existsSync(filePath)) {
          buffer = await fs.promises.readFile(filePath);
          fileName = path.basename(filePath);
          fileExt = path.extname(fileName).slice(1) || 'file';
        } else {
          throw new Error(`文件不存在: ${filePath}`);
        }
      } else if (typeof filePath === 'object' && filePath.buffer) {
        buffer = filePath.buffer;
        fileName = filePath.name || `${ulid()}.${filePath.ext || 'file'}`;
        fileExt = filePath.ext || path.extname(fileName).slice(1) || 'file';
      } else {
        throw new Error('不支持的文件格式');
      }

      // 确保文件名合法
      fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      // 保存文件到media目录
      const targetPath = path.join(mediaDir, fileName);
      await fs.promises.writeFile(targetPath, buffer);

      // 返回访问URL
      const url = `${baseUrl}/media/${fileName}`;
      logger.debug(`文件已保存: ${targetPath} -> ${url}`);
      
      return url;
    } catch (error) {
      logger.error(`processFileToUrl错误: ${error.message}`);
      throw error;
    }
  }

  async processCommand(input, userInfo = {}) {
    try {
      // 解析JSON输入
      if (typeof input === 'string') {
        try { 
          const parsed = JSON.parse(input);
          input = parsed;
        } catch {
          // 不是JSON，保持原样
        }
      }

      // 处理消息数组
      if (Array.isArray(input)) {
        logger.tag("收到消息数组", "命令", "green");
        const event = this.createEvent(input, userInfo);
        return await this.handleEvent(event);
      }

      const trimmedInput = typeof input === 'string' ? input.trim() : '';
      if (!trimmedInput) {
        return { 
          success: true, 
          code: 200, 
          message: "空输入已忽略", 
          timestamp: Date.now() 
        };
      }

      // 内置命令处理
      const builtinCommands = {
        "exit": () => ({ 
          success: true, 
          code: 200, 
          message: "退出命令已接收", 
          command: "exit" 
        }),
        "help": () => ({
          success: true,
          code: 200,
          message: "帮助信息",
          command: "help",
          commands: [
            "exit: 退出程序", 
            "help: 显示帮助", 
            "clear: 清屏", 
            "cleanup: 清理临时文件"
          ]
        }),
        "clear": () => ({ 
          success: true, 
          code: 200, 
          message: "清屏命令已接收", 
          command: "clear" 
        }),
        "cleanup": () => {
          this.cleanupTempFiles();
          return { 
            success: true, 
            code: 200, 
            message: "临时文件清理完成", 
            command: "cleanup" 
          };
        }
      };

      const commandAliases = { 
        "退出": "exit", 
        "帮助": "help", 
        "清屏": "clear", 
        "清理": "cleanup" 
      };
      
      const command = commandAliases[trimmedInput] || trimmedInput;

      if (builtinCommands[command]) {
        return { 
          ...builtinCommands[command](), 
          timestamp: Date.now() 
        };
      }

      logger.tag(trimmedInput, "命令", "green");
      const event = this.createEvent(trimmedInput, userInfo);
      return await this.handleEvent(event);
    } catch (error) {
      logger.error(`处理命令错误: ${error.message}`);
      return { 
        success: false, 
        code: 500, 
        error: error.message, 
        stack: error.stack, 
        timestamp: Date.now() 
      };
    }
  }

  async handleEvent(event) {
    logger.debug(`处理事件: message = ${JSON.stringify(event.message)}, raw_message = ${event.raw_message}`);
    
    // 结果收集器
    const results = [];
    const originalReply = event.reply;

    event.reply = async (...args) => {
      let msg = args[0];
      let processedMsg;
      
      try {
        if (Array.isArray(msg)) {
          processedMsg = await this.processMessageContent(msg);
        } else if (typeof msg === 'object' && msg.type) {
          processedMsg = await this.processMessageContent([msg]);
        } else {
          processedMsg = [{ type: 'text', text: String(msg) }];
        }
        
        const result = await originalReply.apply(event, [processedMsg]);
        
        // 收集结果
        results.push({
          ...result,
          content: processedMsg
        });
        
        return result;
      } catch (error) {
        logger.error(`reply包装错误: ${error.message}`);
        throw error;
      }
    };

    // 处理插件
    await pluginsLoader.deal(event);

    // 触发stdin事件
    Bot.em('stdin.command', {
      command: event.raw_message,
      user_info: {
        user_id: event.user_id,
        nickname: event.sender.nickname
      }
    });

    // 构建响应
    const response = {
      success: true,
      code: 200,
      message: "命令已处理",
      event_id: event.message_id,
      timestamp: Date.now(),
      results: results
    };

    return response;
  }

  /**
   * 处理消息内容，包括图片文件等 [腾讯云](https://cloud.tencent.com/developer/ask/sof/1228959/answer/1705028)
   */
  async processMessageContent(content) {
    if (!Array.isArray(content)) content = [content];
    const processed = [];

    for (const item of content) {
      if (typeof item === "string") {
        processed.push({ type: "text", text: item });
      } else if (typeof item === "object" && item.type) {
        switch (item.type) {
          case 'image':
          case 'video':
          case 'audio':
          case 'file':
            processed.push(await this.processMediaFile(item));
            break;
          case 'forward':
            processed.push(item);
            break;
          default:
            processed.push(item);
        }
      } else {
        processed.push({ type: "text", text: String(item) });
      }
    }
    return processed;
  }

  /**
   * 处理媒体文件，转换为可访问的URL [Node.js + Express 处理图片上传的三种方法](https://www.javascriptcn.com/post/651118fd95b1f8cacd976e49)
   */
  async processMediaFile(item) {
    try {
      let buffer;
      let fileName;
      let fileExt = 'file';
      let mimeType = 'application/octet-stream';

      // 获取文件内容
      if (item.file || item.url || item.path) {
        const fileInfo = await BotUtil.fileType({ 
          file: item.file || item.url || item.path, 
          name: item.name 
        });
        
        buffer = fileInfo.buffer;
        fileName = fileInfo.name || item.name;
        fileExt = fileInfo.type?.ext || 'file';
        mimeType = fileInfo.type?.mime || 'application/octet-stream';
        
        // 如果没有获取到buffer，尝试读取本地文件
        if (!buffer && item.path && fs.existsSync(item.path)) {
          buffer = await fs.promises.readFile(item.path);
          fileName = fileName || path.basename(item.path);
          fileExt = path.extname(fileName).slice(1) || fileExt;
        }
      } else if (item.buffer) {
        buffer = item.buffer;
        fileName = item.name;
      }

      if (!buffer) {
        logger.warn(`无法获取文件内容: ${JSON.stringify(item)}`);
        return item;
      }

      // 生成唯一文件名
      if (!fileName) {
        fileName = `${ulid()}.${fileExt}`;
      } else {
        // 确保文件名安全
        fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        // 如果没有扩展名，添加扩展名
        if (!path.extname(fileName) && fileExt !== 'file') {
          fileName = `${fileName}.${fileExt}`;
        }
      }

      // 保存文件到media目录
      const filePath = path.join(mediaDir, fileName);
      await fs.promises.writeFile(filePath, buffer);
      
      // 生成访问URL
      const baseUrl = Bot.getServerUrl ? Bot.getServerUrl() : `http://localhost:${Bot.httpPort || 3000}`;
      const fileUrl = `${baseUrl}/media/${fileName}`;

      logger.debug(`媒体文件已保存: ${filePath} -> ${fileUrl}`);

      // 如果是图片且设置了自动打开
      if (item.type === 'image' && process.env.OPEN_IMAGES === 'true') {
        this.openImageFile(filePath);
      }

      // 计算文件MD5 [Node.js 中图片如何转为 base64 格式](https://apifox.com/apiskills/how-to-convert-image-to-base64-in-nodejs/)
      const md5 = crypto.createHash('md5').update(buffer).digest('hex');

      return { 
        type: item.type,
        file: fileUrl, 
        url: fileUrl, 
        path: path.resolve(filePath),
        name: fileName,
        size: buffer.length,
        md5: md5,
        mime: mimeType
      };
    } catch (error) {
      logger.error(`处理媒体文件错误: ${error.message}`);
      return item;
    }
  }

  openImageFile(filePath) {
    try {
      const commands = { 
        "win32": `start "" "${filePath}"`, 
        "darwin": `open "${filePath}"`, 
        "linux": `xdg-open "${filePath}"` 
      };
      const platform = os.platform();
      if (commands[platform]) {
        exec(commands[platform]);
      }
    } catch (error) {
      logger.error(`打开图片失败: ${error.message}`);
    }
  }

  setupListeners() {
    this.rl.on('line', async (input) => await this.handleInput(input));
  }

  async handleInput(input) {
    let parsedInput = input;
    try {
      if (typeof input === 'string' && input.startsWith('[') && input.endsWith(']')) {
        parsedInput = JSON.parse(input);
      }
    } catch {}
    
    // 使用stdin适配器
    const result = await this.processCommand(parsedInput, { adapter: 'stdin' });
    
    // 在控制台显示结果
    if (result.results && result.results.length > 0) {
      logger.info('执行结果:');
      result.results.forEach((r, index) => {
        logger.mark(`[${index + 1}] ${this.formatResultForConsole(r)}`);
      });
    }
    
    if (!result.success) {
      logger.error(`命令执行失败: ${result.error || result.message || '未知错误'}`);
    }
    
    this.rl.prompt();
  }

  formatResultForConsole(result) {
    if (!result.content) return '空结果';
    
    if (result.content.length === 1 && result.content[0].type === 'forward') {
      return `转发消息: ${JSON.stringify(result.content[0].messages || result.content[0], null, 2)}`;
    }
    
    const parts = [];
    for (const item of result.content) {
      if (item.type === 'text') {
        parts.push(item.text);
      } else if (item.type === 'image') {
        parts.push(`[图片: ${item.name || '未命名'} - ${item.url}]`);
      } else if (item.type === 'video') {
        parts.push(`[视频: ${item.name || '未命名'} - ${item.url}]`);
      } else if (item.type === 'audio') {
        parts.push(`[音频: ${item.name || '未命名'} - ${item.url}]`);
      } else if (item.type === 'file') {
        parts.push(`[文件: ${item.name || '未命名'} - ${item.url}]`);
      } else {
        parts.push(`[${item.type}]`);
      }
    }
    
    return parts.join(' ');
  }

  startImprovedListener() {
    const appVersion = "1.4.3";
    logger.gradientLine('=', 27);
    logger.title(`葵崽标准输入 v${appVersion}`, "yellow");
    logger.tip("输入 'help' 获取帮助");
    logger.tip("输入 'exit' 退出程序");
    logger.gradientLine('=', 27);
    this.rl.prompt();
  }

  createEvent(input, userInfo = {}) {
    const userId = userInfo.user_id || 'stdin';
    const nickname = userInfo.nickname || userId;
    const time = Math.floor(Date.now() / 1000);
    const messageId = `${userId}_${time}_${Math.floor(Math.random() * 1000)}`;
    const adapter = userInfo.adapter || 'stdin';

    let message = Array.isArray(input) ? input : 
                  typeof input === 'string' && input ? [{ type: "text", text: input }] : [];
    let raw_message = Array.isArray(input) ? 
                      input.map(m => m.type === 'text' ? m.text : `[${m.type}]`).join('') : 
                      typeof input === 'string' ? input : '';

    const event = {
      adapter,
      adapter_id: adapter,
      adapter_name: adapter === 'api' ? 'API适配器' : '标准输入适配器',
      message_id: messageId,
      message_type: userInfo.message_type || "private",
      post_type: userInfo.post_type || "message",
      sub_type: userInfo.sub_type || "friend",
      self_id: userInfo.self_id || this.botId,
      seq: userInfo.seq || 888,
      time,
      uin: userInfo.uin || userId,
      user_id: userId,
      message,
      raw_message,
      isMaster: userInfo.isMaster !== undefined ? userInfo.isMaster : true,
      toString: () => raw_message,
      sender: { 
        card: nickname, 
        nickname, 
        role: userInfo.role || "master", 
        user_id: userId 
      },
      member: { 
        info: { user_id: userId, nickname, last_sent_time: time }, 
        getAvatarUrl: () => userInfo.avatar || `https://q1.qlogo.cn/g?b=qq&s=0&nk=${userId}` 
      },
      friend: {
        sendMsg: async (msg) => this.sendMsg(msg, nickname, userInfo),
        recallMsg: () => logger.mark(`${logger.xrkyzGradient(`[${nickname}]`)} 撤回消息`),
        makeForwardMsg: async (forwardMsg) => this.makeForwardMsg(forwardMsg),
      },
      recall: () => { 
        logger.mark(`${logger.xrkyzGradient(`[${nickname}]`)} 撤回消息`); 
        return true; 
      },
      reply: async (msg) => this.sendMsg(msg, nickname, userInfo),
      group: {
        makeForwardMsg: async (forwardMsg) => this.makeForwardMsg(forwardMsg),
        sendMsg: async (msg) => this.sendMsg(msg, nickname, userInfo)
      },
      bot: Bot.stdin
    };

    if (userInfo.group_id) {
      event.group_id = userInfo.group_id;
      event.group_name = userInfo.group_name || `群${userInfo.group_id}`;
      event.message_type = "group";
    }

    logger.debug(`创建事件: message = ${JSON.stringify(message)}, raw_message = ${raw_message}`);
    return event;
  }

  async sendMsg(msg, nickname, userInfo = {}) {
    if (!msg) return { message_id: null, time: Date.now() / 1000 };
    if (!Array.isArray(msg)) msg = [msg];

    const textLogs = [];
    const processedItems = [];

    for (const item of msg) {
      if (typeof item === "string") {
        textLogs.push(item);
        processedItems.push({ type: 'text', text: item });
      } else if (item?.type) {
        if (['image', 'video', 'audio', 'file'].includes(item.type)) {
          const processed = await this.processMediaFile(item);
          processedItems.push(processed);
          textLogs.push(`[${item.type}: ${processed.name || '未命名'} - ${processed.url || '无URL'}]`);
        } else if (item.type === 'text') {
          textLogs.push(item.text);
          processedItems.push(item);
        } else if (item.type === 'forward') {
          processedItems.push(item);
          textLogs.push(`[转发消息]`);
        } else {
          const typeMap = {
            'at': `[@${item.qq || item.id}]`,
            'face': `[表情:${item.id}]`,
            'poke': `[戳一戳:${item.id || item.qq}]`,
            'xml': '[XML消息]',
            'json': '[JSON消息]',
            'task': `[任务:${item.data?.name || '未知'}]`
          };
          textLogs.push(typeMap[item.type] || `[${item.type}]`);
          processedItems.push(item);
        }
      } else {
        const text = String(item);
        textLogs.push(text);
        processedItems.push({ type: 'text', text });
      }
    }

    // 只在适配器模式下输出到控制台
    if (userInfo.adapter !== 'api' && textLogs.length > 0) {
      logger.tag(textLogs.join("\n"), "输出", "blue");
    }

    // 触发输出事件
    Bot.em('stdin.output', {
      nickname,
      content: processedItems,
      user_info: userInfo
    });

    const result = {
      message_id: `${userInfo.user_id || 'stdin'}_${Date.now()}`,
      content: processedItems,
      time: Date.now() / 1000
    };

    return result;
  }

  async makeForwardMsg(forwardMsg) {
    if (!Array.isArray(forwardMsg)) {
      logger.error("转发消息必须是数组格式");
      return [];
    }

    logger.subtitle("收到转发消息");
    logger.line('-', 40, 'cyan');
    logger.mark(`转发消息内容: ${JSON.stringify(forwardMsg, null, 2)}`);
    logger.line('-', 40, 'cyan');
    return forwardMsg;
  }

  cleanupTempFiles() {
    try {
      const now = Date.now();
      let cleaned = 0;

      for (const dir of [tempDir, mediaDir]) {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          const filePath = path.join(dir, file);
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > 3600000) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        });
      }

      logger.info(`清理了 ${cleaned} 个临时文件`);
    } catch (error) {
      logger.error(`清理临时文件错误: ${error.message}`);
    }
  }

  load() {
    Bot.wsf = Bot.wsf || {};
    Bot.wsf['stdin'] = Bot.wsf['stdin'] || [];
    Bot.wsf['stdin'].push(this.handleStdin.bind(this));
  }

  async handleStdin(input) {
    await this.handleInput(input);
  }
}

// 创建并加载stdin处理器
const stdinHandler = new StdinHandler();
stdinHandler.load();

export default {
  name: 'stdin',
  desc: '标准输入',
  event: 'message',
  priority: 9999,
  rule: () => false
};