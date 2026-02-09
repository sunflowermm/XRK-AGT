import { createInterface } from "readline";
import fs from "fs";
import os from "os";
import { exec } from "child_process";
import path from "path";
import { ulid } from "ulid";
import crypto from 'crypto';
import BotUtil from "#utils/botutil.js";
import paths from "#utils/paths.js";

const tempDir = path.join(paths.data, "stdin");
const mediaDir = path.join(paths.data, "media");
await import("#infrastructure/plugins/loader.js");

// 目录已在 paths.ensureBaseDirs() 中创建，无需重复创建

// 统一的清理函数，避免代码重复
const cleanupTempFiles = () => {
  try {
    const now = Date.now();
    let cleaned = 0;
    for (const dir of [tempDir, mediaDir]) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > 3600000) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch {
          // 忽略单个文件错误
        }
      });
    }
    if (cleaned > 0) {
      logger.debug(`已清理 ${cleaned} 个临时文件`);
    }
  } catch (error) {
    logger.error(`清理临时文件错误: ${error.message}`);
  }
};

// 定时清理（每小时一次）
setInterval(cleanupTempFiles, 3600000);

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
    global.stdinHandler = this;
  }

  initStdinBot() {
    if (!Bot.stdin) {
      if (!Bot.uin.includes(this.botId)) {
        Bot.uin.push(this.botId);
      }

      const stdinBot = {
        uin: this.botId,
        self_id: this.botId,
        nickname: 'StdinBot',
        avatar: 'https://q1.qlogo.cn/g?b=qq&s=0&nk=10000001',
        tasker: { id: 'stdin', name: '标准输入 tasker' },
        tasker_type: 'stdin',
        stat: { start_time: Date.now() / 1000 },
        version: { id: 'stdin', name: 'StdinBot', version: '1.0.5' },
        config: { master: true },
        sendMsg: async (msg) => this.sendMsg(msg, 'stdin', { user_id: 'stdin' }),
        runCommand: async (command, options = {}) => Bot.callStdin
          ? Bot.callStdin(command, { ...options, tasker: 'stdin' })
          : this.processCommand(command, options),
        pickUser: (user_id) => Bot.pickFriend ? Bot.pickFriend(user_id) : null,
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
        fileToUrl: async (filePath, _opts = {}) => {
          try {
            if (typeof filePath === 'string' && filePath.startsWith('http')) {
              return filePath;
            }
            const baseUrl = Bot.getServerUrl ? Bot.getServerUrl() : `http://localhost:${Bot.httpPort || 3000}`;
            return await this.processFileToUrl(filePath, baseUrl);
          } catch (err) {
            logger.error(`文件转URL失败: ${err.message}`);
            return '';
          }
        },
        _ready: true
      };

      Bot.stdin = stdinBot;
      Bot[this.botId] = stdinBot;
    }
  }

  async processFileToUrl(filePath, baseUrl) {
    try {
      let buffer;
      let fileName;
      let fileExt = 'file';

      if (Buffer.isBuffer(filePath)) {
        buffer = filePath;
        const fileType = await BotUtil.fileType({ buffer });
        fileExt = fileType?.type?.ext || 'file';
        fileName = `${ulid()}.${fileExt}`;
      } else if (typeof filePath === 'string') {
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

      fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetPath = path.join(mediaDir, fileName);
      await fs.promises.writeFile(targetPath, buffer);
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


      // 处理消息数组
      if (Array.isArray(input)) {
        logger.tag("收到消息数组", "命令", "green");
        const event = this.createEvent(input, userInfo);
        await this.handleEvent(event);
        return { success: true, code: 200, message: "命令已处理", event_id: event.message_id, timestamp: Date.now() };
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
      await this.handleEvent(event);
      return {
        success: true,
        code: 200,
        message: "命令已处理",
        event_id: event.message_id,
        timestamp: Date.now()
      };
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
    Bot.em('stdin.message', event);
  }

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

      if (!fileName) {
        fileName = `${ulid()}.${fileExt}`;
      } else {
        fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!path.extname(fileName) && fileExt !== 'file') {
          fileName = `${fileName}.${fileExt}`;
        }
      }

      const filePath = path.join(mediaDir, fileName);
      await fs.promises.writeFile(filePath, buffer);
      
      const baseUrl = Bot.getServerUrl ? Bot.getServerUrl() : `http://localhost:${Bot.httpPort || 3000}`;
      const fileUrl = `${baseUrl}/media/${fileName}`;

      logger.debug(`媒体文件已保存: ${filePath} -> ${fileUrl}`);

      // 如果是图片且设置了自动打开
      if (item.type === 'image' && process.env.OPEN_IMAGES === 'true') {
        this.openImageFile(filePath);
      }

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
    await this.processCommand(input, { tasker: 'stdin' });
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

  createEvent(input, userInfo = {}) {
    const userId = userInfo.user_id || 'stdin'
    const nickname = userInfo.nickname || userId
    const time = Math.floor(Date.now() / 1000)
    const messageId = `${userId}_${time}_${Math.floor(Math.random() * 10000)}`
    const eventId = `stdin_${messageId}`

    const message = Array.isArray(input) ? input : 
                    (typeof input === 'string' && input ? [{ type: "text", text: input }] : [])
    const raw_message = Array.isArray(input) ? 
                        input.map(m => m.type === 'text' ? m.text : `[${m.type}]`).join('') : 
                        (typeof input === 'string' ? input : '')

    const event = {
      post_type: userInfo.post_type || "message",
      message_type: userInfo.message_type || "private",
      sub_type: userInfo.sub_type || "friend",
      self_id: userInfo.self_id || this.botId,
      user_id: userId,
      time,
      event_id: eventId,
      message_id: messageId,
      tasker: 'stdin',
      tasker_id: userInfo.tasker || 'stdin',
      tasker_name: userInfo.tasker === 'api' ? 'API tasker' : '标准输入 tasker',
      isStdin: true,
      message,
      raw_message,
      msg: '', // 由parseMessage重新构建，避免重复
      sender: {
        ...(userInfo.sender || {}),
        card: userInfo.sender?.card || nickname,
        nickname: userInfo.sender?.nickname || nickname,
        role: userInfo.sender?.role || userInfo.role || "master",
        user_id: userInfo.sender?.user_id || userId
      },
      bot: Bot.stdin || Bot[this.botId],
      isMaster: userInfo.isMaster !== undefined ? userInfo.isMaster : true,
      isPrivate: !userInfo.group_id,
      isGroup: !!userInfo.group_id,
      toString: () => raw_message
    }
    
    if (userInfo.group_id) {
      event.group_id = userInfo.group_id
      event.group_name = userInfo.group_name || `群${userInfo.group_id}`
      event.message_type = "group"
      event.isGroup = true
      event.isPrivate = false
    }
    
    event.friend = {
      sendMsg: async (msg) => this.sendMsg(msg, nickname, userInfo),
      recallMsg: () => logger.mark(`${logger.xrkyzGradient(`[${nickname}]`)} 撤回消息`),
      makeForwardMsg: async (forwardMsg) => this.makeForwardMsg(forwardMsg)
    }
    
    event.member = { 
      info: { user_id: userId, nickname, last_sent_time: time }, 
      getAvatarUrl: () => userInfo.avatar || `https://q1.qlogo.cn/g?b=qq&s=0&nk=${userId}` 
    }
    
    event.recall = () => { 
      logger.mark(`${logger.xrkyzGradient(`[${nickname}]`)} 撤回消息`)
      return true
    }
    
    event.group = {
      makeForwardMsg: async (forwardMsg) => this.makeForwardMsg(forwardMsg),
      sendMsg: async (msg) => this.sendMsg(msg, nickname, userInfo)
    }

    return event
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

    if (userInfo.tasker !== 'api' && textLogs.length > 0) {
      logger.tag(textLogs.join("\n"), "输出", "blue");
    }

    Bot.em('stdin.output', {
      nickname,
      content: processedItems,
      user_info: userInfo
    });

    return {
      message_id: `${userInfo.user_id || 'stdin'}_${Date.now()}`,
      content: processedItems,
      time: Date.now() / 1000
    };
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
    cleanupTempFiles(); // 复用统一的清理函数
  }

}

new StdinHandler();

export default {
  name: 'stdin',
  desc: '标准输入',
  event: 'message',
  priority: 9999,
  rule: () => false
};