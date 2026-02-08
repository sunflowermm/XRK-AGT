import path from 'path';
import fs from 'fs';
import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';

const EMOTIONS_DIR = path.join(process.cwd(), 'resources/aiimages');
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
 * 
 * 功能分类：
 * - MCP工具（返回JSON）：getGroupInfoEx（获取群信息ex）、getAtAllRemain（获取@全体剩余）、getBanList（获取禁言列表）
 * 
 *   - 互动功能：poke（戳一戳）、emojiReaction（表情回应）、thumbUp（点赞）、sign（签到）
 *   - 群管理：mute/unmute（禁言/解禁）、muteAll/unmuteAll（全员禁言）、setCard（改名片）、setGroupName（改群名）
 *   - 权限管理：setAdmin/unsetAdmin（设置/取消管理员）、setTitle（设置头衔）、kick（踢人）
 *   - 消息管理：setEssence/removeEssence（设置/取消精华）、announce（群公告）、recall（撤回）、setGroupTodo（群代办）
 *   - 消息格式：at（@某人）、reply（回复消息）
 * 
 * 支持表情包、群管理、表情回应等功能
 */
export default class ChatStream extends AIStream {
  static emotionImages = {};
  static messageHistory = new Map();
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
      embedding: { enabled: true }
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
      const botError = errorHandler.handle(
        error,
        { context: 'ChatStream.init', code: ErrorCodes.SYSTEM_ERROR },
        true
      );
      BotUtil.makeLog('error', 
        `[${this.name}] 初始化失败: ${botError.message}`, 
        'ChatStream'
      );
      throw botError;
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
   * 
   * 所有功能都通过 MCP 工具提供
   */
  registerAllFunctions() {
    // 表情包（作为消息段的一部分，不在工具调用/函数解析中处理）
    // 表情包标记会在parseCQToSegments中解析，保持顺序

    this.registerMCPTool('at', {
      description: '@某人',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '要@的用户QQ号'
          }
        },
        required: ['qq']
      },
      handler: async (args = {}, _context = {}) => {
        return { success: true, message: '已@用户', data: { qq: args.qq } };
      },
      enabled: true
    });

    this.registerMCPTool('poke', {
      description: '戳一戳群成员',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '要戳的成员QQ号'
          }
        },
        required: ['qq']
      },
      handler: async (args = {}, context = {}) => {
        if (context.e?.isGroup) {
          try {
            await context.e.group.pokeMember(args.qq);
            await BotUtil.sleep(300);
            return { success: true, message: '戳一戳成功', data: { qq: args.qq } };
          } catch (error) {
            return { success: false, error: error.message };
          }
        }
        return { success: false, error: '非群聊环境' };
      },
      enabled: true
    });

    this.registerMCPTool('reply', {
      description: '回复消息',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: {
            type: 'string',
            description: '要回复的消息ID'
          },
          content: {
            type: 'string',
            description: '回复内容'
          }
        },
        required: ['content']
      },
      handler: async (args = {}, _context = {}) => {
        return { success: true, message: '消息已回复', data: { content: args.content } };
      },
      enabled: true
    });

    this.registerMCPTool('emojiReaction', {
      description: '对消息进行表情回应',
      inputSchema: {
        type: 'object',
        properties: {
          msgId: {
            type: 'string',
            description: '消息ID'
          },
          emojiType: {
            type: 'string',
            description: '表情类型',
            enum: ['like', 'love', 'laugh', 'wow', 'sad', 'angry']
          }
        },
        required: ['msgId', 'emojiType']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup || !EMOJI_REACTIONS[args.emojiType]) {
          return { success: false, error: !context.e?.isGroup ? '非群聊环境' : '无效表情类型' };
        }
        
        const emojiIds = EMOJI_REACTIONS[args.emojiType];
        if (!emojiIds || emojiIds.length === 0) {
          return { success: false, error: '表情类型无可用表情ID' };
        }
        
        const emojiId = Number(emojiIds[Math.floor(Math.random() * emojiIds.length)]);
        const msgId = String(args.msgId ?? '').trim();
        
        if (!msgId) {
          return { success: false, error: '消息ID不能为空' };
        }
        
        try {
          const group = context.e.group;
          if (group && typeof group.setEmojiLike === 'function') {
            const result = await group.setEmojiLike(msgId, emojiId, true);
            if (result !== null && result !== undefined) {
              await BotUtil.sleep(200);
              return { success: true, message: '表情回应成功', data: { msgId, emojiId } };
            }
          }
          return { success: false, error: '表情回应功能不可用' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('thumbUp', {
      description: '给群成员点赞',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '要点赞的成员QQ号'
          },
          count: {
            type: 'number',
            description: '点赞次数（1-50）',
            default: 1
          }
        },
        required: ['qq']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        const thumbCount = Math.min(parseInt(args.count) || 1, 50);
        try {
          const member = context.e.group?.pickMember(args.qq);
          if (member && typeof member.thumbUp === 'function') {
            await member.thumbUp(thumbCount);
            await BotUtil.sleep(300);
            return { success: true, message: '点赞成功', data: { qq: args.qq, count: thumbCount } };
          }
          return { success: false, error: '点赞功能不可用' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('sign', {
      description: '群签到',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.sign();
          await BotUtil.sleep(300);
          return { success: true, message: '签到成功' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('mute', {
      description: '禁言群成员',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '要禁言的成员QQ号'
          },
          duration: {
            type: 'number',
            description: '禁言时长（秒）'
          }
        },
        required: ['qq', 'duration']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.muteMember(args.qq, args.duration);
          await BotUtil.sleep(300);
          return { success: true, message: '禁言成功', data: { qq: args.qq, duration: args.duration } };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('unmute', {
      description: '解除禁言',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '要解禁的成员QQ号'
          }
        },
        required: ['qq']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.muteMember(args.qq, 0);
          await BotUtil.sleep(300);
          return { success: true, message: '解禁成功', data: { qq: args.qq } };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('muteAll', {
      description: '全员禁言',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.muteAll(true);
          await BotUtil.sleep(300);
          return { success: true, message: '全员禁言成功' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('unmuteAll', {
      description: '解除全员禁言',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.muteAll(false);
          await BotUtil.sleep(300);
          return { success: true, message: '解除全员禁言成功' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('setCard', {
      description: '修改群名片',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '成员QQ号'
          },
          card: {
            type: 'string',
            description: '新名片'
          }
        },
        required: ['qq', 'card']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.setCard(args.qq, args.card);
          await BotUtil.sleep(300);
          return { success: true, message: '修改名片成功', data: { qq: args.qq, card: args.card } };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('setGroupName', {
      description: '修改群名',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '新群名'
          }
        },
        required: ['name']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.setName(args.name);
          await BotUtil.sleep(300);
          return { success: true, message: '修改群名成功', data: { name: args.name } };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('setAdmin', {
      description: '设置管理员',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '成员QQ号'
          }
        },
        required: ['qq']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.setAdmin(args.qq, true);
          await BotUtil.sleep(300);
          return { success: true, message: '设置管理员成功', data: { qq: args.qq } };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('unsetAdmin', {
      description: '取消管理员',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '成员QQ号'
          }
        },
        required: ['qq']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.setAdmin(args.qq, false);
          await BotUtil.sleep(300);
          return { success: true, message: '取消管理员成功', data: { qq: args.qq } };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('setTitle', {
      description: '设置专属头衔',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '成员QQ号'
          },
          title: {
            type: 'string',
            description: '头衔名称'
          },
          duration: {
            type: 'number',
            description: '持续时间（秒）',
            default: -1
          }
        },
        required: ['qq', 'title']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.setTitle(args.qq, args.title, args.duration || -1);
          await BotUtil.sleep(300);
          return { success: true, message: '设置头衔成功', data: { qq: args.qq, title: args.title } };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('kick', {
      description: '踢出群成员',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '要踢出的成员QQ号'
          },
          reject: {
            type: 'boolean',
            description: '是否拒绝再次申请',
            default: false
          }
        },
        required: ['qq']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          await context.e.group.kickMember(args.qq, args.reject || false);
          await BotUtil.sleep(300);
          return { success: true, message: '踢出成员成功', data: { qq: args.qq } };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('setEssence', {
      description: '设置精华消息',
      inputSchema: {
        type: 'object',
        properties: {
          msgId: {
            type: 'string',
            description: '消息ID'
          }
        },
        required: ['msgId']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        const msgId = String(args.msgId ?? '').trim();
        if (!msgId) {
          return { success: false, error: '消息ID不能为空' };
        }
        
        try {
          const group = context.e.group;
          if (group && typeof group.setEssenceMessage === 'function') {
            await group.setEssenceMessage(msgId);
            await BotUtil.sleep(300);
            return { success: true, message: '设置精华成功', data: { msgId } };
          } else if (context.e.bot && context.e.bot.sendApi) {
            await context.e.bot.sendApi('set_essence_msg', { message_id: msgId });
            await BotUtil.sleep(300);
            return { success: true, message: '设置精华成功', data: { msgId } };
          }
          return { success: false, error: 'API不可用' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('removeEssence', {
      description: '取消精华消息',
      inputSchema: {
        type: 'object',
        properties: {
          msgId: {
            type: 'string',
            description: '消息ID'
          }
        },
        required: ['msgId']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        const msgId = String(args.msgId ?? '').trim();
        if (!msgId) {
          return { success: false, error: '消息ID不能为空' };
        }
        
        try {
          const group = context.e.group;
          if (group && typeof group.removeEssenceMessage === 'function') {
            await group.removeEssenceMessage(msgId);
            await BotUtil.sleep(300);
            return { success: true, message: '取消精华成功', data: { msgId } };
          }
          return { success: false, error: 'API不可用' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('announce', {
      description: '发送群公告',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '公告内容'
          },
          image: {
            type: 'string',
            description: '公告图片URL（可选）'
          }
        },
        required: ['content']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        const content = String(args.content ?? '').trim();
        if (!content) {
          return { success: false, error: '公告内容不能为空' };
        }
        
        try {
          const group = context.e.group;
          const image = args.image ? String(args.image).trim() : undefined;
          
          if (group && typeof group.sendNotice === 'function') {
            const options = {};
            if (image) options.image = image;
            const result = await group.sendNotice(content, options);
            if (result !== null && result !== undefined) {
              await BotUtil.sleep(300);
              return { success: true, message: '发送群公告成功', data: { content } };
            }
          } else if (context.e.bot && context.e.bot.sendApi) {
            const apiParams = { group_id: context.e.group_id, content };
            if (image) apiParams.image = image;
            const result = await context.e.bot.sendApi('_send_group_notice', apiParams);
            if (result && result.status === 'ok') {
              await BotUtil.sleep(300);
              return { success: true, message: '发送群公告成功', data: { content } };
            }
          }
          return { success: false, error: 'API不可用' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('recall', {
      description: '撤回消息',
      inputSchema: {
        type: 'object',
        properties: {
          msgId: {
            type: 'string',
            description: '要撤回的消息ID'
          }
        },
        required: ['msgId']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e) {
          return { success: false, error: '事件对象不存在' };
        }
        
        try {
          let canRecall = false;
          let messageInfo = null;
          
          if (context.e.bot && context.e.bot.sendApi) {
            try {
              messageInfo = await context.e.bot.sendApi('get_msg', { message_id: args.msgId });
            } catch {
              // 忽略获取消息信息失败
            }
          }
          
          if (context.e.isGroup) {
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
                return { success: false, error: isSelfMsg ? '消息已超过3分钟' : '需要管理员权限' };
              }
            } else if (isAdmin) {
              canRecall = true;
            }
          } else {
            if (messageInfo && messageInfo.data) {
              const msgData = messageInfo.data;
              const isSelfMsg = String(msgData.sender?.user_id) === String(context.e.self_id);
              const msgTime = msgData.time || 0;
              const currentTime = Math.floor(Date.now() / 1000);
              const timeDiff = currentTime - msgTime;
              
              if (isSelfMsg && timeDiff <= 180) {
                canRecall = true;
              } else {
                return { success: false, error: isSelfMsg ? '已超过3分钟' : '不是自己的消息' };
              }
            } else {
              canRecall = true;
            }
          }
          
          if (canRecall) {
            if (context.e.isGroup && context.e.group) {
              await context.e.group.recallMsg(args.msgId);
            } else if (context.e.bot) {
              await context.e.bot.sendApi('delete_msg', { message_id: args.msgId });
            }
            await BotUtil.sleep(300);
            return { success: true, message: '消息撤回成功', data: { msgId: args.msgId } };
          }
          
          return { success: false, error: '无法撤回消息' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('getGroupInfoEx', {
      description: '获取群的扩展详细信息（包括更多群信息）',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '此功能仅在群聊中可用' };
        }
        
        try {
          const group = context.e.group;
          if (group && typeof group.getInfoEx === 'function') {
            const info = await group.getInfoEx();
            BotUtil.makeLog('debug', `获取群信息ex成功: ${JSON.stringify(info)}`, 'ChatStream');
            return {
              success: true,
              data: info
            };
          }
          return { success: false, error: 'API不可用' };
        } catch (error) {
          BotUtil.makeLog('warn', `获取群信息ex失败: ${error.message}`, 'ChatStream');
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('getAtAllRemain', {
      description: '获取群@全体成员的剩余次数',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '此功能仅在群聊中可用' };
        }
        
        try {
          const group = context.e.group;
          if (group && typeof group.getAtAllRemain === 'function') {
            const remain = await group.getAtAllRemain();
            BotUtil.makeLog('debug', `@全体成员剩余次数: ${JSON.stringify(remain)}`, 'ChatStream');
            return {
              success: true,
              data: remain
            };
          }
          return { success: false, error: 'API不可用' };
        } catch (error) {
          BotUtil.makeLog('warn', `获取@全体剩余次数失败: ${error.message}`, 'ChatStream');
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('getBanList', {
      description: '获取当前被禁言的成员列表',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '此功能仅在群聊中可用' };
        }
        
        try {
          const group = context.e.group;
          if (group && typeof group.getBanList === 'function') {
            const banList = await group.getBanList();
            BotUtil.makeLog('debug', `群禁言列表: ${JSON.stringify(banList)}`, 'ChatStream');
            return {
              success: true,
              data: banList
            };
          }
          return { success: false, error: 'API不可用' };
        } catch (error) {
          BotUtil.makeLog('warn', `获取禁言列表失败: ${error.message}`, 'ChatStream');
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('setGroupTodo', {
      description: '设置群代办',
      inputSchema: {
        type: 'object',
        properties: {
          msgId: {
            type: 'string',
            description: '消息ID'
          }
        },
        required: ['msgId']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        const msgId = String(args.msgId ?? '').trim();
        if (!msgId) {
          return { success: false, error: '消息ID不能为空' };
        }
        
        try {
          if (context.e.bot && context.e.bot.sendApi) {
            const result = await context.e.bot.sendApi('set_group_todo', {
              group_id: context.e.group_id,
              message_id: msgId
            });
            if (result !== null && result !== undefined) {
              await BotUtil.sleep(300);
              return { success: true, message: '设置群代办成功', data: { msgId } };
            }
          }
          return { success: false, error: 'API不可用' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
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
      
      // 优先使用真实的消息ID，确保准确
      // 优先级：message_id > real_id > messageId > id > source?.id
      // 参考 tasker 层消息结构：message_id 和 real_id 都是有效的消息ID
      let messageId = e.message_id || e.real_id || e.messageId || e.id || e.source?.id;
      
      // 如果消息ID不存在，尝试从消息段中提取（回复消息的ID）
      if (!messageId && e.message && Array.isArray(e.message)) {
        const replySeg = e.message.find(seg => seg.type === 'reply');
        if (replySeg && replySeg.id) {
          messageId = replySeg.id;
        }
      }
      
      // 如果仍然没有消息ID，使用时间戳作为临时ID（不推荐，但作为兜底）
      if (!messageId) {
        messageId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        BotUtil.makeLog('debug', `消息ID缺失，使用临时ID: ${messageId}`, 'ChatStream');
      } else {
        messageId = String(messageId);
      }

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
    const member = e.group?.pickMember(e.self_id);
    const roleValue = member?.role;
    return roleValue === 'owner' ? '群主' : 
           roleValue === 'admin' ? '管理员' : '成员';
  }

  recordAIResponse(e, text, executedFunctions = []) {
    if (!text || !text.trim()) return;
    
    const functionInfo = executedFunctions.length > 0 
      ? `[执行了: ${executedFunctions.join(', ')}] ` 
      : '';
    const botName = e.bot?.nickname || e.bot?.info?.nickname || e.bot?.name || 'Bot';
    const message = `${functionInfo}${text}`;
    const msgData = {
      user_id: e.self_id,
      nickname: botName,
      message,
      message_id: Date.now().toString(),
      time: Date.now(),
      platform: 'onebot'
    };
    
    if (e?.isGroup && e.group_id) {
      const history = ChatStream.messageHistory.get(e.group_id) || [];
      history.push(msgData);
      if (history.length > 50) {
        history.shift();
      }
    }
    
    if (this.embeddingConfig?.enabled) {
      const historyKey = e.group_id || `private_${e.user_id}`;
      this.storeMessageWithEmbedding(historyKey, msgData).catch(() => {});
    }
  }

  /**
   * 构建功能列表提示（仅用于向模型说明“具备哪些能力”，不约定任何特殊命令格式）
   */
  buildFunctionsPrompt(context = {}) {
    const { botRole = '成员' } = context;

    const enabledFuncs = this.getEnabledFunctions();
    if (enabledFuncs.length === 0) return '';

    const filteredFuncs = enabledFuncs.filter(func => {
      if (func.requireAdmin) {
        return botRole === '管理员' || botRole === '群主';
      }
      if (func.requireOwner) {
        return botRole === '群主';
      }
      return true;
    });

    const lines = filteredFuncs
      .filter(f => f.description)
      .map(f => `- ${f.description}`);

    if (lines.length === 0) return '';

    return `【可用能力】
你具备以下群聊相关辅助能力（例如 @ 成员、戳一戳、表情回应、管理操作等）。
这些能力会通过系统的工具调用机制自动触发，你只需要专注于自然语言对话和决策，不要在回复中设计任何特殊命令格式。

能力列表：
${lines.join('\n')}`;
  }

  async buildSystemPrompt(context) {
    const { e, question } = context;
    const persona = question?.persona || '我是AI助手';
    const isGlobalTrigger = question?.isGlobalTrigger || false;
    const botRole = question?.botRole || await this.getBotRole(e);
    const dateStr = question?.dateStr || new Date().toLocaleString('zh-CN');
    
    let embeddingHint = '';
    if (this.embeddingConfig?.enabled) {
      embeddingHint = '\n💡 系统会自动检索相关历史对话（通过子服务端向量服务）\n';
    }

    const botName = e.bot?.nickname || e.bot?.info?.nickname || e.bot?.name || 'AI助手';
    const isMaster = e.isMaster === true;
    
    return `【人设设定】
${persona}

【身份信息】
名字：${botName} | QQ号：${e.self_id}${e.isGroup ? ` | 群号：${e.group_id} | 身份：${botRole}` : ''}
${isMaster ? '⚠️ 现在跟你讲话的是主人，请对主人友好和尊重。' : ''}

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

【工具说明】
所有功能都通过MCP工具调用协议提供，包括：@成员、戳一戳、表情回应、群管理等。


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
5. 可以使用表情回应等互动，但重点是表达情绪` : 
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
      content: await this.buildSystemPrompt({ e, question })
    });

    // 基础文本
    const text = typeof question === 'string'
      ? question
      : (question?.content ?? question?.text ?? '');

    // 从事件中提取图片（OneBot 消息段）
    const images = [];
    const replyImages = [];

    if (e && Array.isArray(e.message)) {
      let inReplyRegion = false;
      for (const seg of e.message) {
        if (seg.type === 'reply') {
          inReplyRegion = true;
          continue;
        }
        if (seg.type === 'image') {
          const url = seg.url || seg.data?.url || seg.data?.file;
          if (!url) continue;
          if (inReplyRegion) {
            replyImages.push(url);
          } else {
            images.push(url);
          }
        }
      }
    }

    // 若无图片，则仍然用纯文本，兼容旧逻辑
    if (images.length === 0 && replyImages.length === 0) {
      messages.push({
        role: 'user',
        content: text
      });
    } else {
      messages.push({
        role: 'user',
        content: {
          text: text || '',
          images,
          replyImages
        }
      });
    }

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
    
    const mergedMessages = [messages[0]];
    
    // 获取当前用户消息的 message_id
    const currentMsgId = e.message_id || e.real_id || e.messageId || e.id || e.source?.id || '未知';
    const currentUserNickname = e.sender?.card || e.sender?.nickname || e.user?.name || '用户';
    const currentContent = typeof userMessage.content === 'string' 
      ? userMessage.content 
      : (userMessage.content?.text ?? '');
    
    // 格式化单条消息
    const formatMessage = (msg) => {
      const msgId = msg.message_id || msg.real_id || '未知';
      return `${msg.nickname}(${msg.user_id})[ID:${msgId}]: ${msg.message}`;
    };
    
    // 过滤历史记录：排除当前消息（避免重复）
    const filteredHistory = history.filter(msg => 
      String(msg.message_id) !== String(currentMsgId)
    );
    
    // 去重：按消息ID去重，保留最新的
    const uniqueHistory = [];
    const seenIds = new Set();
    for (let i = filteredHistory.length - 1; i >= 0; i--) {
      const msg = filteredHistory[i];
      const msgId = msg.message_id || msg.real_id;
      if (msgId && !seenIds.has(String(msgId))) {
        seenIds.add(String(msgId));
        uniqueHistory.unshift(msg);
      }
    }
    
    if (isGlobalTrigger) {
      const recentMessages = uniqueHistory.slice(-15);
      if (recentMessages.length > 0) {
        mergedMessages.push({
          role: 'user',
          content: `[群聊记录]\n${recentMessages.map(formatMessage).join('\n')}\n\n你闲来无事点开群聊，看到这些发言。请根据你的个性和人设，自然地表达情绪和感受，不要试图解决问题。`
        });
      }
    } else {
      const recentMessages = uniqueHistory.slice(-10);
      
      // 分别显示历史记录和当前消息
      if (recentMessages.length > 0) {
        mergedMessages.push({
          role: 'user',
          content: `[群聊记录]\n${recentMessages.map(formatMessage).join('\n')}`
        });
      }
      
      // 当前消息单独显示
      if (currentMsgId !== '未知' && currentContent) {
        // 若原始内容包含图片结构，则保留图片，仅在 text 前加上当前消息标记
        if (typeof userMessage.content === 'object' && userMessage.content !== null) {
          const content = userMessage.content;
          const baseText = content.text || content.content || currentContent;
          mergedMessages.push({
            role: 'user',
            content: {
              text: `[当前消息]\n${currentUserNickname}(${e.user_id})[ID:${currentMsgId}]: ${baseText}`,
              images: content.images || [],
              replyImages: content.replyImages || []
            }
          });
        } else {
          mergedMessages.push({
            role: 'user',
            content: `[当前消息]\n${currentUserNickname}(${e.user_id})[ID:${currentMsgId}]: ${currentContent}`
          });
        }
      } else if (currentContent) {
        // 如果无法获取消息ID，使用原始消息格式（保留多模态结构）
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
    }
    
    return mergedMessages;
  }

  async execute(e, messages, config) {
    try {
      // 构建消息上下文
      if (!Array.isArray(messages)) {
        messages = await this.buildChatContext(e, messages);
      }
      messages = this.mergeMessageHistory(messages, e);
      const query = Array.isArray(messages) ? this.extractQueryFromMessages(messages) : messages;
      messages = await this.buildEnhancedContext(e, query, messages);
      
      // 调用AI获取响应
      const response = await this.callAI(messages, config);
      
      if (!response) {
        return null;
      }

      // 工具调用由 LLM 工厂（tool calling + MCP）内部完成，这里只负责发送最终文本
      const text = (response ?? '').toString().trim();
      if (text) {
        await this.sendMessages(e, text);
        this.recordAIResponse(e, text, []);
      }
      return text || '';
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
            // poke等其他不支持整合的CQ码：当前忽略或由下游按需扩展
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
    
  }

  async cleanup() {
    await super.cleanup();
    
    if (ChatStream.cleanupTimer) {
      clearInterval(ChatStream.cleanupTimer);
      ChatStream.cleanupTimer = null;
    }
  }
}