import path from 'path';
import fs from 'fs';
import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';

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
 * 支持表情包、群管理、表情回应等功能
 */
export default class ChatStream extends AIStream {
  static emotionImages = {};
  static messageHistory = new Map();
  static userCache = new Map();
  static cleanupTimer = null;

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
    
    try {
      await BotUtil.mkdir(EMOTIONS_DIR);
      await this.loadEmotionImages();
      this.registerAllFunctions();
      
      if (!ChatStream.cleanupTimer) {
        ChatStream.cleanupTimer = setInterval(() => this.cleanupCache(), 300000);
      }
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
      } catch (error) {
        ChatStream.emotionImages[emotion] = [];
      }
    }
  }

  /**
   * 注册所有功能
   */
  registerAllFunctions() {
    // 1. 表情包（作为消息段的一部分，不在parseFunctions中处理）
    // 表情包标记会在parseCQToSegments中解析，保持顺序

    // 2. @功能
    this.registerFunction('at', {
      description: '@某人',
      prompt: `[CQ:at,qq=QQ号] - @某人`,
      parser: (text, context) => {
        return { functions: [], cleanText: text };
      },
      enabled: true
    });

    // 3. 戳一戳（已禁用）
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
      enabled: false
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
          
          if (context.e.bot && context.e.bot.sendApi) {
            try {
              messageInfo = await context.e.bot.sendApi('get_msg', {
                message_id: params.msgId
              });
            } catch (error) {
              // 忽略获取消息信息失败
            }
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

  /**
   * 记录消息到历史（多平台兼容）
   * 历史记录包含：用户信息、消息内容、消息ID、时间戳
   * 支持onebot、其他平台的事件对象
   */
  recordMessage(e) {
    if (!e) return;
    
    try {
      // 多平台兼容：获取群组ID或用户ID
      const groupId = e.group_id || e.groupId || null;
      const userId = e.user_id || e.userId || e.user?.id || null;
      const historyKey = groupId || `private_${userId}`;

      // 多平台兼容：提取消息内容
      let message = '';
      if (e.raw_message) {
        message = e.raw_message;
      } else if (e.msg) {
        message = e.msg;
      } else if (e.message) {
        if (typeof e.message === 'string') {
          message = e.message;
        } else if (Array.isArray(e.message)) {
          // onebot格式：消息段数组
          message = e.message.map(seg => {
            switch (seg.type) {
              case 'text': return seg.text || '';
              case 'image': return '[图片]';
              case 'at': return `@${seg.qq || seg.user_id || ''}`;
              case 'reply': return `[回复:${seg.id || ''}]`;
              default: return '';
            }
          }).join('');
        }
      } else if (e.content) {
        message = typeof e.content === 'string' ? e.content : e.content.text || '';
      }

      // 多平台兼容：获取用户信息
      const nickname = e.sender?.card || e.sender?.nickname || 
                      e.user?.name || e.user?.nickname || 
                      e.from?.name || '未知';
      const messageId = e.message_id || e.messageId || e.id || Date.now().toString();

      const msgData = {
        user_id: userId,
        nickname,
        message,
        message_id: messageId,
        time: e.time || Date.now(),
        platform: e.platform || 'onebot' // 标识平台类型
      };

      // 群聊内存历史（仅群聊）
      if (groupId && e.isGroup !== false) {
        if (!ChatStream.messageHistory.has(groupId)) {
          ChatStream.messageHistory.set(groupId, []);
        }
        const history = ChatStream.messageHistory.get(groupId);
        history.push(msgData);
        // 限制历史记录数量，避免内存溢出
        if (history.length > 50) {
          history.shift();
        }
      }

      // 语义检索存储（启用embedding时）
      if (this.embeddingConfig?.enabled && message && message.length > 5) {
        this.storeMessageWithEmbedding(historyKey, msgData).catch(() => {});
      }
    } catch (error) {
      BotUtil.makeLog('debug', `记录消息失败: ${error.message}`, 'ChatStream');
    }
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
    } catch (error) {
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

【消息段格式】
以下格式会作为消息段整合到回复中，保持顺序：
[开心] [惊讶] [伤心] [大笑] [害怕] [生气] - 表情包（可与其他内容组合，保持顺序）
[CQ:at,qq=QQ号] - @某人（可与其他内容组合，保持顺序）
[CQ:image,file=图片路径] - 图片（可与其他内容组合，保持顺序）
[CQ:reply,id=消息ID] - 回复消息（会应用到整个消息，回复段会自动放在最前面）

重要说明：
- 聊天记录中每条消息都标注了消息ID（格式：消息ID:xxx）
- 如果需要回复某条消息，使用 [CQ:reply,id=消息ID] 格式，其中消息ID就是聊天记录中标注的ID
- 例如：聊天记录显示"张三(123456)[消息ID:1051113239]: 你好"，要回复这条消息，使用 [CQ:reply,id=1051113239]

可用命令：
${prompts.join('\n')}

示例：[开心]今天真好→发送表情+文本（顺序：表情在前） | 今天真好[开心]→文本+表情（顺序：文本在前） | [禁言:123456:600]→禁言600秒
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

    const botName = e.bot?.nickname || e.bot?.info?.nickname || 'AI助手';
    const isMaster = e.isMaster === true;
    
    return `【人设设定】
${persona}

【身份信息】
名字：${botName}
QQ号：${e.self_id}
${e.isGroup ? `群名：${e.group?.group_name || '未知'}
群号：${e.group_id}
身份：${botRole}` : ''}
${isMaster ? '\n⚠️ 重要提示：现在跟你讲话的是主人，请对主人友好和尊重。' : ''}

【时间信息】
当前时间：${dateStr}

【场景设定】
${isGlobalTrigger ? '你闲来无事点开群聊，看到小伙伴们的发言，想表达一下自己的情绪和看法。' : '你被召唤回复，需要针对性地回答问题或提供帮助。'}
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
`1. 保持你的个性和人设，即使是表达情绪也要体现自己的特点
2. 专注于表达情绪和感受，不要试图解决问题或给出建议
3. 自然地使用"哦"、"行吧"、"我觉得"、"感觉"、"可能"等表达情绪的词
4. 像真人一样随意聊天，不要显得像AI助手
5. 可以使用表情回应等互动，但重点是表达情绪
6. 语气自然随意，不要刻意帮助别人` : 
`1. 回复要有针对性
2. 积极互动
3. 多使用表情回应
4. 适当使用表情包
5. 管理功能仅在必要时使用${isMaster ? '\n6. 对主人友好和尊重' : ''}`}`;
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
            `${msg.nickname}(${msg.user_id})[消息ID:${msg.message_id}]: ${msg.message}`
          ).join('\n')}\n\n你闲来无事点开群聊，看到小伙伴们的这些发言。请根据你的个性和人设，自然地表达你的情绪和感受，保持真实的反应，不要试图解决问题。\n\n注意：每条消息都有消息ID，如果需要回复某条消息，使用 [CQ:reply,id=消息ID] 格式。`
        });
      }
    } else {
      const recentMessages = history.slice(-10);
      if (recentMessages.length > 0) {
        mergedMessages.push({
          role: 'user',
          content: `[群聊记录]\n${recentMessages.map(msg => 
            `${msg.nickname}(${msg.user_id})[消息ID:${msg.message_id}]: ${msg.message}`
          ).join('\n')}\n\n注意：每条消息都有消息ID，如果需要回复某条消息，使用 [CQ:reply,id=消息ID] 格式。`
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
      // 构建消息上下文
      if (!Array.isArray(messages)) {
        const baseMessages = await this.buildChatContext(e, messages);
        messages = await this.buildEnhancedContext(e, messages, baseMessages);
      } else {
        messages = this.mergeMessageHistory(messages, e);
        const query = this.extractQueryFromMessages(messages);
        messages = await this.buildEnhancedContext(e, query, messages);
      }
      
      // 调用AI获取响应
      const context = { e, question: null, config };
      const response = await this.callAI(messages, config);
      
      if (!response) {
        return null;
      }
      
      // 解析功能和文本
      const { functions, cleanText } = this.parseFunctions(response, context);
      
      // 执行所有功能（记录到历史）
      const executedFunctions = [];
      for (const func of functions) {
        try {
          await this.executeFunction(func.type, func.params, context);
          executedFunctions.push(func.type);
        } catch (error) {
          BotUtil.makeLog('error', `函数执行失败[${func.type}]: ${error.message}`, 'ChatStream');
        }
      }
      
      if (cleanText && cleanText.trim()) {
        // 记录AI响应到内存历史（包含执行的函数信息）
        if (e?.isGroup && e.group_id) {
          const history = ChatStream.messageHistory.get(e.group_id) || [];
          const functionInfo = executedFunctions.length > 0 
            ? `[执行了: ${executedFunctions.join(', ')}] ` 
            : '';
          history.push({
            user_id: e.self_id,
            nickname: e.bot?.nickname || e.bot?.info?.nickname || 'Bot',
            message: `${functionInfo}${cleanText}`,
            message_id: Date.now().toString(),
            time: Date.now(),
            platform: 'onebot'
          });
          if (history.length > 50) {
            history.shift();
          }
        }
        
        await this.sendMessages(e, cleanText);
        
        // 记录到embedding记忆系统（包含执行的函数信息）
        if (this.embeddingConfig?.enabled) {
          const historyKey = e.group_id || `private_${e.user_id}`;
          const functionInfo = executedFunctions.length > 0 
            ? `[执行了: ${executedFunctions.join(', ')}] ` 
            : '';
          this.storeMessageWithEmbedding(historyKey, {
            user_id: e.self_id,
            nickname: e.bot?.nickname || e.bot?.info?.nickname || 'Bot',
            message: `${functionInfo}${cleanText}`,
            message_id: Date.now().toString(),
            time: Date.now()
          }).catch(() => {});
        }
      }
      
      return '';
    } catch (error) {
      BotUtil.makeLog('error', 
        `工作流执行失败[${this.name}]: ${error.message}`, 
        'ChatStream'
      );
      return null;
    }
  }

  /**
   * 解析CQ码和表情包标记为segment数组，保持顺序
   * @param {string} text - 包含CQ码和表情包标记的文本
   * @param {Object} e - 事件对象
   * @returns {Object} { replyId: string|null, segments: Array } - 回复ID和消息段数组
   */
  parseCQToSegments(text, e) {
    const segments = [];
    let replyId = null;
    
    // 先提取回复消息段（只取第一个）
    const replyMatch = text.match(/\[CQ:reply,id=(\d+)\]/);
    if (replyMatch) {
      replyId = replyMatch[1];
      // 从文本中移除回复CQ码
      text = text.replace(/\[CQ:reply,id=\d+\]/g, '').trim();
    }
    
    // 使用正则匹配所有标记（CQ码和表情包标记），按顺序处理
    // 匹配模式：CQ码 [CQ:type,params] 或表情包 [表情类型]
    const combinedPattern = /(\[CQ:[^\]]+\]|\[(开心|惊讶|伤心|大笑|害怕|生气)\])/g;
    const markers = [];
    let match;
    
    // 收集所有标记及其位置
    while ((match = combinedPattern.exec(text)) !== null) {
      markers.push({
        content: match[0],
        index: match.index,
        emotion: match[2] // 如果是表情包，这里会有值
      });
    }
    
    // 按照标记顺序解析
    let currentIndex = 0;
    for (const marker of markers) {
      // 添加标记前的文本
      if (marker.index > currentIndex) {
        const textBefore = text.slice(currentIndex, marker.index);
        if (textBefore.trim()) {
          segments.push(textBefore);
        }
      }
      
      // 处理标记
      if (marker.emotion) {
        // 表情包标记
        const image = this.getRandomEmotionImage(marker.emotion);
        if (image) {
          const seg = global.segment || segment;
          segments.push(seg.image(image));
        }
      } else if (marker.content.startsWith('[CQ:')) {
        // CQ码
        const cqMatch = marker.content.match(/\[CQ:(\w+)(?:,([^\]]+))?\]/);
        if (cqMatch) {
          const [, type, params] = cqMatch;
          const paramObj = {};
          const seg = global.segment || segment;
          
          if (params) {
            params.split(',').forEach(p => {
              const [key, value] = p.split('=');
              if (key && value) {
                paramObj[key.trim()] = value.trim();
              }
            });
          }
          
          switch (type) {
            case 'at':
              if (paramObj.qq) {
                // 验证QQ号是否在群聊记录中（如果是群聊）
                if (e.isGroup) {
                  const history = ChatStream.messageHistory.get(e.group_id) || [];
                  const userExists = history.some(msg => 
                    String(msg.user_id) === String(paramObj.qq)
                  );
                  
                  if (userExists || e.isMaster) {
                    segments.push(seg.at(paramObj.qq));
                  }
                } else {
                  // 私聊直接添加
                  segments.push(seg.at(paramObj.qq));
                }
              }
              break;
            case 'image':
              if (paramObj.file) {
                segments.push(seg.image(paramObj.file));
              }
              break;
            // poke等其他不支持整合的CQ码已在parseFunctions中处理
          }
        }
      }
      
      currentIndex = marker.index + marker.content.length;
    }
    
    // 添加最后剩余的文本（如果没有标记，currentIndex为0，会添加整个文本）
    if (currentIndex < text.length) {
      const textAfter = text.slice(currentIndex);
      if (textAfter.trim()) {
        segments.push(textAfter);
      }
    }
    
    // 合并相邻的文本段，避免重复
    const mergedSegments = [];
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      const last = mergedSegments[mergedSegments.length - 1];
      
      // 如果当前段和上一段都是文本字符串，合并它们
      if (typeof current === 'string' && typeof last === 'string') {
        mergedSegments[mergedSegments.length - 1] = last + current;
      } else {
        mergedSegments.push(current);
      }
    }
    
    return { replyId, segments: mergedSegments };
  }

  async sendMessages(e, cleanText) {
    if (!cleanText || !cleanText.trim()) return;

    const messages = cleanText.split('|').map(m => m.trim()).filter(Boolean);
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      
      // 解析CQ码为segment数组
      const { replyId, segments } = this.parseCQToSegments(msg, e);
      
      // 如果有回复ID或解析出了segment，使用segment方式发送
      if (replyId || segments.length > 0) {
        if (replyId) {
          // 有回复ID：回复段必须在最前面（OneBot协议要求）
          // segment.reply返回 { type: "reply", id, ... }，makeMsg会转换为 { type: "reply", data: { id } }
          const seg = global.segment || segment;
          const replySegment = seg.reply(replyId);
          const replySegments = segments.length > 0 
            ? [replySegment, ...segments] 
            : [replySegment, ' '];
          await e.reply(replySegments);
        } else {
          // 没有回复ID：直接发送segments
          await e.reply(segments);
        }
      } else {
        // 如果没有解析出任何内容，直接发送原始文本
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
  }
}