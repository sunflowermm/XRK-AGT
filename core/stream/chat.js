import path from 'path';
import fs from 'fs';
import AIStream from '../../src/infrastructure/aistream/aistream.js';
import BotUtil from '../../src/utils/botutil.js';

const _path = process.cwd();
const EMOTIONS_DIR = path.join(_path, 'resources/aiimages');
const EMOTION_TYPES = ['开心', '惊讶', '伤心', '大笑', '害怕', '生气'];

// 表情回应映射
const EMOJI_REACTIONS = {
  '开心': ['4', '14', '21', '28', '76', '79', '99', '182', '201', '290'],
  '惊讶': ['26', '32', '97', '180', '268', '289'],
  '伤心': ['5', '9', '106', '111', '173', '174'],
  '大笑': ['4', '12', '28', '101', '182', '281'],
  '害怕': ['26', '27', '41', '96'],
  '喜欢': ['42', '63', '85', '116', '122', '319'],
  '爱心': ['66', '122', '319'],
  '生气': ['8', '23', '39', '86', '179', '265']
};

function randomRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 聊天工作流
 * 支持表情包、群管理、戳一戳、表情回应等功能
 */
export default class ChatStream extends AIStream {
  static emotionImages = {};
  static messageHistory = new Map();
  static userCache = new Map();
  static cleanupTimer = null;
  static initialized = false;

  constructor() {
    super({
      name: 'chat',
      description: '智能聊天互动工作流',
      version: '3.2.0',
      author: 'XRK',
      priority: 10,
      config: {
        enabled: true,
        temperature: 0.8,
        maxTokens: 6000,
        topP: 0.9,
        presencePenalty: 0.6,
        frequencyPenalty: 0.6
      },
      embedding: {
        enabled: true,
        provider: 'lightweight',
      }
    });
  }

  /**
   * 初始化工作流
   */
  async init() {
    await super.init();
    
    if (ChatStream.initialized) {
      return;
    }
    
    try {
      await BotUtil.mkdir(EMOTIONS_DIR);
      await this.loadEmotionImages();
      this.registerAllFunctions();
      
      if (!ChatStream.cleanupTimer) {
        ChatStream.cleanupTimer = setInterval(() => this.cleanupCache(), 300000);
      }
      
      ChatStream.initialized = true;
    } catch (error) {
      BotUtil.makeLog('error', 
        `[${this.name}] 初始化失败: ${error.message}`, 
        'ChatStream'
      );
      throw error;
    }
  }

  /**
   * 加载表情包
   */
  async loadEmotionImages() {
    for (const emotion of EMOTION_TYPES) {
      const emotionDir = path.join(EMOTIONS_DIR, emotion);
      try {
        await BotUtil.mkdir(emotionDir);
        const files = await fs.promises.readdir(emotionDir);
        const imageFiles = files.filter(file => 
          /\.(jpg|jpeg|png|gif)$/i.test(file)
        );
        ChatStream.emotionImages[emotion] = imageFiles.map(file => 
          path.join(emotionDir, file)
        );
      } catch {
        ChatStream.emotionImages[emotion] = [];
      }
    }
  }

  /**
   * 注册所有功能
   */
  registerAllFunctions() {
    // 1. 表情包
    this.registerFunction('emotion', {
      description: '发送表情包',
      prompt: `【表情包】
[开心] [惊讶] [伤心] [大笑] [害怕] [生气] - 发送对应表情包（一次只能用一个）`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        
        const emotionRegex = /\[(开心|惊讶|伤心|大笑|害怕|生气)\]/;
        const match = emotionRegex.exec(text);
        if (match) {
          functions.push({ 
            type: 'emotion', 
            params: { emotion: match[1] },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
          cleanText = text.replace(/\[(开心|惊讶|伤心|大笑|害怕|生气)\]/g, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        const image = this.getRandomEmotionImage(params.emotion);
        if (image && context.e) {
          await context.e.reply([{ type: 'image', data: { file: image } }]);
        }
      },
      enabled: true
    });

    // 2. @功能
    this.registerFunction('at', {
      description: '@某人',
      prompt: `[CQ:at,qq=QQ号] - @某人`,
      parser: (text, context) => {
        return { functions: [], cleanText: text };
      },
      enabled: true
    });

    // 3. 戳一戳
    this.registerFunction('poke', {
      description: '戳一戳',
      prompt: `[CQ:poke,qq=QQ号] - 戳一戳某人`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const pokeRegex = /\[CQ:poke,qq=(\d+)\]/g;
        let match;
        
        while ((match = pokeRegex.exec(text))) {
          functions.push({ 
            type: 'poke', 
            params: { qq: match[1] },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(pokeRegex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.pokeMember(params.qq);
            await BotUtil.sleep(300);
          } catch (error) {
            // 静默失败
          }
        }
      },
      enabled: true
    });

    // 4. 回复
    this.registerFunction('reply', {
      description: '回复消息',
      prompt: `[CQ:reply,id=消息ID] - 回复某条消息`,
      parser: (text, context) => {
        return { functions: [], cleanText: text };
      },
      enabled: true
    });

    // 5. 表情回应
    this.registerFunction('emojiReaction', {
      description: '表情回应',
      prompt: `[回应:消息ID:表情类型] - 给消息添加表情回应
表情类型: 开心/惊讶/伤心/大笑/害怕/喜欢/爱心/生气`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[回应:([^:]+):([^\]]+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'emojiReaction', 
            params: { msgId: match[1], emojiType: match[2] },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup && EMOJI_REACTIONS[params.emojiType]) {
          const emojiIds = EMOJI_REACTIONS[params.emojiType];
          const emojiId = emojiIds[Math.floor(Math.random() * emojiIds.length)];
          try {
            await context.e.group.setEmojiLike(params.msgId, emojiId);
            await BotUtil.sleep(200);
          } catch (error) {
            // 静默失败
          }
        }
      },
      enabled: true
    });

    // 6. 点赞
    this.registerFunction('thumbUp', {
      description: '点赞',
      prompt: `[点赞:QQ号:次数] - 给某人点赞（1-50次）`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[点赞:(\d+):(\d+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'thumbUp', 
            params: { qq: match[1], count: match[2] },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          const thumbCount = Math.min(parseInt(params.count) || 1, 50);
          try {
            const member = context.e.group.pickMember(params.qq);
            await member.thumbUp(thumbCount);
            await BotUtil.sleep(300);
          } catch (error) {
            // 静默失败
          }
        }
      },
      enabled: true
    });

    // 7. 签到
    this.registerFunction('sign', {
      description: '群签到',
      prompt: `[签到] - 执行群签到`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        
        if (text.includes('[签到]')) {
          functions.push({ 
            type: 'sign', 
            params: {}, 
            order: text.indexOf('[签到]')
          });
          cleanText = text.replace(/\[签到\]/g, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.sign();
            await BotUtil.sleep(300);
          } catch (error) {
            // 静默失败
          }
        }
      },
      enabled: true
    });

    // 8. 禁言
    this.registerFunction('mute', {
      description: '禁言群成员',
      prompt: `[禁言:QQ号:时长] - 禁言某人（时长单位：秒，最大2592000秒/30天）
示例：[禁言:123456:600] 禁言10分钟`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[禁言:(\d+):(\d+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          const duration = Math.min(parseInt(match[2]), 2592000);
          functions.push({ 
            type: 'mute', 
            params: { qq: match[1], duration },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.muteMember(params.qq, params.duration);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `禁言失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 9. 解禁
    this.registerFunction('unmute', {
      description: '解除禁言',
      prompt: `[解禁:QQ号] - 解除某人的禁言`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[解禁:(\d+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'unmute', 
            params: { qq: match[1] },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.muteMember(params.qq, 0);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `解禁失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 10. 全员禁言
    this.registerFunction('muteAll', {
      description: '全员禁言',
      prompt: `[全员禁言] - 开启全员禁言`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        
        if (text.includes('[全员禁言]')) {
          functions.push({ 
            type: 'muteAll', 
            params: { enable: true },
            order: text.indexOf('[全员禁言]')
          });
          cleanText = text.replace(/\[全员禁言\]/g, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.muteAll(true);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `全员禁言失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 11. 解除全员禁言
    this.registerFunction('unmuteAll', {
      description: '解除全员禁言',
      prompt: `[解除全员禁言] - 关闭全员禁言`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        
        if (text.includes('[解除全员禁言]')) {
          functions.push({ 
            type: 'unmuteAll', 
            params: { enable: false },
            order: text.indexOf('[解除全员禁言]')
          });
          cleanText = text.replace(/\[解除全员禁言\]/g, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.muteAll(false);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `解除全员禁言失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 12. 改群名片
    this.registerFunction('setCard', {
      description: '修改群名片',
      prompt: `[改名片:QQ号:新名片] - 修改某人的群名片
示例：[改名片:123456:小明]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[改名片:(\d+):([^\]]+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'setCard', 
            params: { qq: match[1], card: match[2] },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.setCard(params.qq, params.card);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `改名片失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 13. 改群名
    this.registerFunction('setGroupName', {
      description: '修改群名',
      prompt: `[改群名:新群名] - 修改当前群的群名
示例：[改群名:快乐大家庭]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[改群名:([^\]]+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'setGroupName', 
            params: { name: match[1] },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.setName(params.name);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `改群名失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 14. 设置管理员
    this.registerFunction('setAdmin', {
      description: '设置管理员',
      prompt: `[设管:QQ号] - 设置某人为管理员`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[设管:(\d+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'setAdmin', 
            params: { qq: match[1], enable: true },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.setAdmin(params.qq, true);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `设置管理员失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireOwner: true
    });

    // 15. 取消管理员
    this.registerFunction('unsetAdmin', {
      description: '取消管理员',
      prompt: `[取管:QQ号] - 取消某人的管理员`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[取管:(\d+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'unsetAdmin', 
            params: { qq: match[1], enable: false },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.setAdmin(params.qq, false);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `取消管理员失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireOwner: true
    });

    // 16. 设置头衔
    this.registerFunction('setTitle', {
      description: '设置专属头衔',
      prompt: `[头衔:QQ号:头衔名:时长] - 设置某人的专属头衔
时长：-1为永久，单位秒
示例：[头衔:123456:大佬:-1]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[头衔:(\d+):([^:]+):(-?\d+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'setTitle', 
            params: { 
              qq: match[1], 
              title: match[2],
              duration: parseInt(match[3])
            },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.setTitle(params.qq, params.title, params.duration);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `设置头衔失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireOwner: true
    });

    // 17. 踢人
    this.registerFunction('kick', {
      description: '踢出群成员',
      prompt: `[踢人:QQ号] - 踢出某人
[踢人:QQ号:拒绝] - 踢出某人并拒绝再次加群`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[踢人:(\d+)(?::([^\]]+))?\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'kick', 
            params: { 
              qq: match[1],
              reject: match[2] === '拒绝'
            },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.kickMember(params.qq, params.reject);
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `踢人失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 18. 设置精华消息
    this.registerFunction('setEssence', {
      description: '设置精华消息',
      prompt: `[设精华:消息ID] - 将某条消息设为精华`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[设精华:([^\]]+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'setEssence', 
            params: { msgId: String(match[1]) },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup && context.e.bot) {
          try {
            await context.e.bot.sendApi('set_essence_msg', {
              message_id: String(params.msgId)
            });
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `设置精华失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 19. 取消精华消息
    this.registerFunction('removeEssence', {
      description: '取消精华消息',
      prompt: `[取消精华:消息ID] - 取消某条精华消息`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[取消精华:([^\]]+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'removeEssence', 
            params: { msgId: String(match[1]) },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup && context.e.bot) {
          try {
            await context.e.bot.sendApi('delete_essence_msg', {
              message_id: String(params.msgId)
            });
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `取消精华失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 20. 发送群公告
    this.registerFunction('announce', {
      description: '发送群公告',
      prompt: `[公告:公告内容] - 发送群公告
示例：[公告:明天晚上8点开会]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[公告:([^\]]+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'announce', 
            params: { content: match[1] },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (context.e?.isGroup && context.e.bot) {
          try {
            await context.e.bot.sendApi('_send_group_notice', {
              group_id: context.e.group_id,
              content: params.content
            });
            await BotUtil.sleep(300);
          } catch (error) {
            BotUtil.makeLog('warn', `发送公告失败: ${error.message}`, 'ChatStream');
          }
        }
      },
      enabled: true,
      requireAdmin: true
    });

    // 21. 撤回消息
    this.registerFunction('recall', {
      description: '撤回消息',
      prompt: `[撤回:消息ID] - 撤回指定消息
注意：
- 撤回别人的消息需要管理员权限
- 撤回自己的消息需要在3分钟内
示例：[撤回:1234567890]`,
      parser: (text, context) => {
        const functions = [];
        let cleanText = text;
        const regex = /\[撤回:([^\]]+)\]/g;
        let match;
        
        while ((match = regex.exec(text))) {
          functions.push({ 
            type: 'recall', 
            params: { msgId: String(match[1]) },
            order: typeof match.index === 'number' ? match.index : text.indexOf(match[0])
          });
        }
        
        if (functions.length > 0) {
          cleanText = text.replace(regex, '').trim();
        }
        
        return { functions, cleanText };
      },
      handler: async (params, context) => {
        if (!context.e) return;
        
        try {
          let canRecall = false;
          let messageInfo = null;
          
          try {
            if (context.e.bot && context.e.bot.sendApi) {
              messageInfo = await context.e.bot.sendApi('get_msg', {
                message_id: params.msgId
              });
            }
          } catch (error) {
            // 忽略获取消息信息失败
          }
          
          if (context.e.isGroup) {
            // 群聊消息撤回逻辑
            const botRole = await this.getBotRole(context.e);
            const isAdmin = botRole === '管理员' || botRole === '群主';
            
            if (messageInfo && messageInfo.data) {
              const msgData = messageInfo.data;
              const isSelfMsg = String(msgData.sender?.user_id) === String(context.e.self_id);
              const msgTime = msgData.time || 0;
              const currentTime = Math.floor(Date.now() / 1000);
              const timeDiff = currentTime - msgTime;
              
              if (isSelfMsg && timeDiff <= 180) {
                canRecall = true;
              } else if (isAdmin) {
                canRecall = true;
              } else {
                BotUtil.makeLog('warn', 
                  `无法撤回: ${isSelfMsg ? '消息已超过3分钟' : '需要管理员权限'}`, 
                  'ChatStream'
                );
                return;
              }
            } else if (isAdmin) {
              canRecall = true;
            }
          } else {
            // 私聊消息撤回逻辑
            if (messageInfo && messageInfo.data) {
              const msgData = messageInfo.data;
              const isSelfMsg = String(msgData.sender?.user_id) === String(context.e.self_id);
              const msgTime = msgData.time || 0;
              const currentTime = Math.floor(Date.now() / 1000);
              const timeDiff = currentTime - msgTime;
              
              if (isSelfMsg && timeDiff <= 180) {
                canRecall = true;
              } else {
                BotUtil.makeLog('warn', 
                  `无法撤回私聊消息: ${isSelfMsg ? '已超过3分钟' : '不是自己的消息'}`, 
                  'ChatStream'
                );
                return;
              }
            } else {
              canRecall = true;
            }
          }
          
          if (canRecall) {
            if (context.e.isGroup && context.e.group) {
              await context.e.group.recallMsg(params.msgId);
            } else if (context.e.bot) {
              await context.e.bot.sendApi('delete_msg', {
                message_id: params.msgId
              });
            }
            await BotUtil.sleep(300);
          }
        } catch (error) {
          BotUtil.makeLog('warn', `撤回消息失败: ${error.message}`, 'ChatStream');
        }
      },
      enabled: true,
      requirePermissionCheck: true
    });
  }

  /**
   * 获取随机表情
   */
  getRandomEmotionImage(emotion) {
    const images = ChatStream.emotionImages[emotion];
    if (!images || images.length === 0) return null;
    return images[Math.floor(Math.random() * images.length)];
  }

  recordMessage(e) {
    try {
      const isGroup = e.isGroup;
      const historyKey = e.group_id || `private_${e.user_id}`;

      let message = e.raw_message || e.msg || '';
      if (e.message && Array.isArray(e.message)) {
        message = e.message.map(seg => {
          switch (seg.type) {
            case 'text': return seg.text;
            case 'image': return '[图片]';
            case 'at': return `[CQ:at,qq=${seg.qq}]`;
            case 'reply': return `[CQ:reply,id=${seg.id}]`;
            default: return '';
          }
        }).join('');
      }

      const msgData = {
        user_id: e.user_id,
        nickname: e.sender?.card || e.sender?.nickname || '未知',
        message,
        message_id: e.message_id,
        time: Date.now()
      };

      // 群聊内存历史，仅用于构建「群聊记录」提示
      if (isGroup) {
        if (!ChatStream.messageHistory.has(e.group_id)) {
          ChatStream.messageHistory.set(e.group_id, []);
        }
        const history = ChatStream.messageHistory.get(e.group_id);
        history.push(msgData);
        if (history.length > 30) {
          history.shift();
        }
      }

      // 全局 Redis 历史（群聊 + 私聊），用于语义检索
      if (this.embeddingConfig?.enabled && message && message.length > 5) {
        this.storeMessageWithEmbedding(historyKey, msgData).catch(() => {});
      }
    } catch {}
  }

  async getBotRole(e) {
    if (!e.isGroup) return '成员';
    
    const cacheKey = `bot_role_${e.group_id}`;
    const cached = ChatStream.userCache.get(cacheKey);
    
    if (cached && Date.now() - cached.time < 300000) {
      return cached.role;
    }
    
    try {
      const member = e.group.pickMember(e.self_id);
      const info = await member.getInfo();
      const role = info.role === 'owner' ? '群主' : 
                   info.role === 'admin' ? '管理员' : '成员';
      
      ChatStream.userCache.set(cacheKey, { role, time: Date.now() });
      return role;
    } catch {
      return '成员';
    }
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

可用命令：
${prompts.join('\n')}

示例：[开心]今天真好→发送表情+文本 | [CQ:poke,qq=123456]→戳一戳 | [禁言:123456:600]→禁言600秒
注意：格式完全匹配，参数完整，执行结果不显示在回复中但功能生效`;
  }

  buildSystemPrompt(context) {
    const { e, question } = context;
    const persona = question?.persona || '我是AI助手';
    const isGlobalTrigger = question?.isGlobalTrigger || false;
    const botRole = question?.botRole || '成员';
    const dateStr = question?.dateStr || new Date().toLocaleString('zh-CN');
    
    let functionsPrompt = this.buildFunctionsPrompt();
    
    // 根据权限过滤功能（在命令列表部分进行过滤）
    if (functionsPrompt) {
      const lines = functionsPrompt.split('\n');
      const filteredLines = [];
      let inCommandsSection = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 找到"可用命令："标记
        if (line.includes('可用命令：')) {
          inCommandsSection = true;
          filteredLines.push(line);
          continue;
        }
        
        // 在命令区域之外，保留所有行
        if (!inCommandsSection) {
          filteredLines.push(line);
          continue;
        }
        
        // 在命令区域内，根据权限过滤
        if (botRole === '成员') {
          const restrictedKeywords = [
            '禁言', '解禁', '全员禁言', '改名片', '改群名', 
            '设管', '取管', '头衔', '踢人', '精华', '公告'
          ];
          if (restrictedKeywords.some(keyword => line.includes(keyword))) {
            continue; // 跳过管理员功能
          }
        } else if (botRole === '管理员') {
          if (line.includes('[设管') || line.includes('[取管') || line.includes('[头衔')) {
            continue; // 跳过群主专属功能
          }
        }
        
        filteredLines.push(line);
      }
      
      functionsPrompt = filteredLines.join('\n');
    }

    let embeddingHint = '';
    if (this.embeddingConfig?.enabled && this.embeddingReady) {
      embeddingHint = '\n💡 系统会自动检索相关历史对话\n';
    }

    const botName = e.bot?.nickname || e.bot?.info?.nickname || Bot.nickname || 'AI助手';
    
    return `【人设设定】
${persona}

【身份信息】
名字：${botName}
QQ号：${e.self_id}
${e.isGroup ? `群名：${e.group?.group_name || '未知'}
群号：${e.group_id}
身份：${botRole}` : ''}

【时间信息】
当前时间：${dateStr}

【触发方式】
${isGlobalTrigger ? '观察群聊后主动发言' : '被召唤回复'}
${embeddingHint}
【基础规则】
1. 你是一个真实的QQ用户，不是AI助手
2. 说话要自然、简洁、有个性
3. 最多使用一个竖线分隔符(|)
4. 适当使用表情包和互动功能
5. 管理功能需谨慎使用，避免滥用

${functionsPrompt}

【重要限制】
1. 每次回复最多一个表情包
2. 最多一个竖线(|)分隔
3. @人前确认QQ号在群聊记录中
4. 不要重复使用相同功能
5. 管理操作要有正当理由

【注意事项】
${isGlobalTrigger ? 
`1. 主动发言要有新意
2. 可以戳一戳活跃成员
3. 语气自然` : 
`1. 回复要有针对性
2. 积极互动`}
3. 多使用戳一戳和表情回应
4. 适当使用表情包
5. 管理功能仅在必要时使用
${e.isMaster ? '6. 对主人友好和尊重' : ''}`;
  }

  async buildChatContext(e, question) {
    if (Array.isArray(question)) {
      return question;
    }
    
    const messages = [];
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt({ e, question })
    });
    
    const userMessage = typeof question === 'string' ? question : 
                       (question?.content || question?.text || '');
    messages.push({
      role: 'user',
      content: userMessage
    });
    
    return messages;
  }

  extractQueryFromMessages(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          return msg.content;
        } else if (msg.content?.text) {
          return msg.content.text;
        }
      }
    }
    return '';
  }

  mergeMessageHistory(messages, e) {
    if (!e?.isGroup || messages.length < 2) {
      return messages;
    }

    const userMessage = messages[messages.length - 1];
    const isGlobalTrigger = userMessage.content?.isGlobalTrigger || false;
    const history = ChatStream.messageHistory.get(e.group_id) || [];
    
    if (history.length === 0) {
      return messages;
    }

    const mergedMessages = [messages[0]];
    
    if (isGlobalTrigger) {
      const recentMessages = history.slice(-15);
      if (recentMessages.length > 0) {
        mergedMessages.push({
          role: 'user',
          content: `[群聊记录]\n${recentMessages.map(msg => 
            `${msg.nickname}(${msg.user_id})[${msg.message_id}]: ${msg.message}`
          ).join('\n')}\n\n请对当前话题发表你的看法。`
        });
      }
    } else {
      const recentMessages = history.slice(-10);
      if (recentMessages.length > 0) {
        mergedMessages.push({
          role: 'user',
          content: `[群聊记录]\n${recentMessages.map(msg => 
            `${msg.nickname}(${msg.user_id})[${msg.message_id}]: ${msg.message}`
          ).join('\n')}`
        });
      }
      
      const content = userMessage.content;
      if (typeof content === 'object' && content.text) {
        mergedMessages.push({
          role: 'user',
          content: {
            text: content.text,
            images: content.images || [],
            replyImages: content.replyImages || []
          }
        });
      } else {
        mergedMessages.push(userMessage);
      }
    }
    
    return mergedMessages;
  }

  async execute(e, messages, config) {
    try {
      if (!Array.isArray(messages)) {
        const baseMessages = await this.buildChatContext(e, messages);
        messages = await this.buildEnhancedContext(e, messages, baseMessages);
      } else {
        messages = this.mergeMessageHistory(messages, e);
        const query = this.extractQueryFromMessages(messages);
        messages = await this.buildEnhancedContext(e, query, messages);
      }
      
      const context = { e, question: null, config };
      const response = await this.callAI(messages, config);
      
      if (!response) {
        return null;
      }
      
      const { functions, cleanText } = this.parseFunctions(response, context);
      
      const emotionIndex = functions.findIndex(f => f.type === 'emotion');
      const isEmotionLast = emotionIndex === functions.length - 1 && functions.length > 0;
      
      if (isEmotionLast && cleanText) {
        for (let i = 0; i < functions.length - 1; i++) {
          await this.executeFunction(functions[i].type, functions[i].params, context);
        }
        
        await this.sendMessages(e, cleanText);
        await BotUtil.sleep(500);
        await this.executeFunction(functions[emotionIndex].type, functions[emotionIndex].params, context);
      } else {
        for (let i = 0; i < functions.length; i++) {
          await this.executeFunction(functions[i].type, functions[i].params, context);
          if (i < functions.length - 1 && !functions[i].noDelay) {
            await BotUtil.sleep(2500);
          }
        }
        
        if (cleanText) {
          await this.sendMessages(e, cleanText);
        }
      }
      
      if (this.embeddingConfig.enabled && cleanText && e) {
        const groupId = e.group_id || `private_${e.user_id}`;
        this.storeMessageWithEmbedding(groupId, {
          user_id: e.self_id,
          nickname: e.bot?.nickname || e.bot?.info?.nickname || 'Bot',
          message: cleanText,
          message_id: Date.now().toString(),
          time: Date.now()
        }).catch(() => {});
      }
      
      return cleanText;
    } catch (error) {
      BotUtil.makeLog('error', 
        `工作流执行失败[${this.name}]: ${error.message}`, 
        'ChatStream'
      );
      return null;
    }
  }

  parseCQCodes(text, e) {
    const segments = [];
    const parts = text.split(/(\[CQ:[^\]]+\])/);
    
    for (const part of parts) {
      if (part.startsWith('[CQ:')) {
        const match = part.match(/\[CQ:(\w+)(?:,([^\]]+))?\]/);
        if (match) {
          const [, type, params] = match;
          const paramObj = {};
          
          if (params) {
            params.split(',').forEach(p => {
              const [key, value] = p.split('=');
              paramObj[key] = value;
            });
          }
          
          switch (type) {
            case 'at':
              if (e.isGroup && paramObj.qq) {
                const history = ChatStream.messageHistory.get(e.group_id) || [];
                const userExists = history.some(msg => 
                  String(msg.user_id) === String(paramObj.qq)
                );
                
                if (userExists || e.isMaster) {
                  segments.push({ type: 'at', data: { qq: String(paramObj.qq) } });
                }
              }
              break;
            case 'reply':
              if (paramObj.id) {
                segments.push({ type: 'reply', data: { id: String(paramObj.id) } });
              }
              break;
            case 'image':
              if (paramObj.file) {
                segments.push({ type: 'image', data: { file: paramObj.file } });
              }
              break;
            default:
              break;
          }
        }
      } else if (part.trim()) {
        segments.push({ type: 'text', data: { text: part } });
      }
    }
    
    return segments.length > 0 ? segments : null;
  }

  async sendMessages(e, cleanText) {
    if (!cleanText) return

    const messages = cleanText.includes('|') 
      ? cleanText.split('|').map(m => m.trim()).filter(m => m)
      : [cleanText];
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const segments = this.parseCQCodes(msg, e);
      
      if (segments && segments.length > 0) {
        await e.reply(segments);
      } else if (msg) {
        await e.reply(msg);
      }
      
      if (i < messages.length - 1) {
        await BotUtil.sleep(randomRange(800, 1500));
      }
    }
  }

  cleanupCache() {
    const now = Date.now();
    
    for (const [groupId, messages] of ChatStream.messageHistory.entries()) {
      const filtered = messages.filter(msg => now - msg.time < 1800000);
      if (filtered.length === 0) {
        ChatStream.messageHistory.delete(groupId);
      } else {
        ChatStream.messageHistory.set(groupId, filtered);
      }
    }
    
    for (const [key, data] of ChatStream.userCache.entries()) {
      if (now - data.time > 300000) {
        ChatStream.userCache.delete(key);
      }
    }
  }

  async cleanup() {
    await super.cleanup();
    
    if (ChatStream.cleanupTimer) {
      clearInterval(ChatStream.cleanupTimer);
      ChatStream.cleanupTimer = null;
    }
    
    ChatStream.initialized = false;
  }
}