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
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        if (!e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }

        const qq = String(args.qq || '').trim();
        if (!qq) {
          return { success: false, error: 'QQ号不能为空' };
        }

        try {
          const seg = global.segment || segment;
          // 只执行 @，不附带多余文案，文案交给 LLM 正常回复
          await e.reply([seg.at(qq)]);
          await BotUtil.sleep(200);
          // 返回给 LLM 的结果尽量直观，顺便提示不要对同一用户重复调用
          return {
            success: true,
            message: `已在当前群聊中成功 @ 了 QQ=${qq} 的用户，如无特殊需要请不要再次对同一用户调用此工具。`,
            data: { qq }
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('poke', {
      description: '戳一戳群成员（qq 为空时默认戳当前说话用户）',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '要戳的成员QQ号（可选，默认是当前说话用户）'
          }
        },
        required: []
      },
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        BotUtil.makeLog(
          'debug',
          `[chat.poke] 调用上下文: hasE=${Boolean(e)}, isGroup=${e?.isGroup}, message_type=${e?.message_type}, group_id=${e?.group_id}, user_id=${e?.user_id}`,
          'ChatStream'
        );
        if (!e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }

        // 如果没有显式给 qq，则默认戳当前触发指令的用户
        const targetQq = String(args.qq || e.user_id || '').trim();
        if (!targetQq) {
          return { success: false, error: '无法确定要戳的成员QQ号' };
        }

        try {
          await e.group.pokeMember(targetQq);
          await BotUtil.sleep(300);
          return { success: true, message: '戳一戳成功', data: { qq: targetQq } };
        } catch (error) {
          return { success: false, error: error.message };
        }
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
      description: '对某条群消息进行表情回应（默认回应最近一条他人消息）',
      inputSchema: {
        type: 'object',
        properties: {
          msgId: {
            type: 'string',
            description: '要回应的消息ID（可选，不填则自动选择最近一条消息）'
          },
          emojiType: {
            type: 'string',
            description: '表情类型，可选：开心、惊讶、伤心、大笑、害怕、喜欢、爱心、生气',
            enum: ['开心', '惊讶', '伤心', '大笑', '害怕', '喜欢', '爱心', '生气']
          }
        },
        required: ['emojiType']
      },
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        BotUtil.makeLog(
          'debug',
          `[chat.emojiReaction] 调用上下文: hasE=${Boolean(e)}, isGroup=${e?.isGroup}, message_type=${e?.message_type}, group_id=${e?.group_id}, user_id=${e?.user_id}`,
          'ChatStream'
        );
        if (!e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }

        // 兼容英文枚举到内部中文映射
        const typeMap = {
          like: '喜欢',
          love: '爱心',
          laugh: '大笑',
          wow: '惊讶',
          sad: '伤心',
          angry: '生气'
        };
        let emojiType = args.emojiType;
        if (emojiType && typeMap[emojiType]) {
          emojiType = typeMap[emojiType];
        }

        if (!EMOJI_REACTIONS[emojiType]) {
          return { success: false, error: '无效表情类型' };
        }

        const emojiIds = EMOJI_REACTIONS[emojiType];
        if (!emojiIds || emojiIds.length === 0) {
          return { success: false, error: '表情类型无可用表情ID' };
        }

        // 如果没有传 msgId，则尝试使用最近一条他人消息的 ID
        let msgId = String(args.msgId ?? '').trim();
        if (!msgId && e.group_id) {
          const history = ChatStream.messageHistory.get(e.group_id) || [];
          const lastOtherMsg = [...history].reverse().find(
            m => String(m.user_id) !== String(e.self_id) && m.message_id
          );
          if (lastOtherMsg) {
            msgId = String(lastOtherMsg.message_id);
          }
        }

        if (!msgId) {
          return { success: false, error: '找不到可回应的消息ID' };
        }

        const emojiId = Number(emojiIds[Math.floor(Math.random() * emojiIds.length)]);

        try {
          const group = e.group;
          if (group && typeof group.setEmojiLike === 'function') {
            const result = await group.setEmojiLike(msgId, emojiId, true);
            if (result !== undefined) {
              await BotUtil.sleep(200);
              return { success: true, message: '表情回应成功', data: { msgId, emojiId, emojiType } };
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
        required: ['card']
      },
      handler: async (args = {}, context = {}) => {
        if (!context.e?.isGroup) {
          return { success: false, error: '非群聊环境' };
        }
        
        try {
          const e = context.e;
          // 优先使用显式传入的 qq；否则：
          // - 如果用户说的是“把你自己改成 X”，模型一般会把 qq 留空，这时默认修改机器人的名片
          // - 如果没法判断，就回退到当前说话人
          let targetQq = String(args.qq || '').trim();
          if (!targetQq) {
            // 优先理解为修改机器人自己的名片
            targetQq = String(e.self_id || e.bot?.uin || '').trim() || String(e.user_id || '').trim();
          }
          if (!targetQq) {
            return { success: false, error: '无法确定要修改名片的成员QQ号' };
          }

          await context.e.group.setCard(targetQq, args.card);
          await BotUtil.sleep(300);
          return { success: true, message: '修改名片成功', data: { qq: targetQq, card: args.card } };
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
            if (result !== undefined) {
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
        const e = context.e;
        
        const msgId = String(args.msgId ?? '').trim();
        if (!msgId) {
          return { success: false, error: '消息ID不能为空' };
        }
        
        try {
          // 权限校验：只有管理员/群主才允许设置群代办
          const botRole = await this.getBotRole(e);
          const isAdmin = botRole === '管理员' || botRole === '群主';
          if (!isAdmin) {
            return { success: false, error: '需要管理员或群主权限才能设置群代办' };
          }

          if (e.bot && e.bot.sendApi) {
            const result = await e.bot.sendApi('set_group_todo', {
              group_id: e.group_id,
              message_id: msgId
            });
            if (result !== undefined) {
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

    // 获取好友列表（QQ号、昵称、备注）
    this.registerMCPTool('getFriendList', {
      description: '获取当前机器人的好友列表（QQ号、昵称、备注）',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        const e = context.e;
        const bot = e?.bot;
        if (!bot || typeof bot.getFriendMap !== 'function') {
          return { success: false, error: '当前适配器不支持获取好友列表' };
        }

        try {
          const map = await bot.getFriendMap();
          const friends = [];
          if (map && typeof map.forEach === 'function') {
            map.forEach((info, uid) => {
              if (!uid) return;
              const qq = String(uid);
              const nickname = info?.nickname || '';
              const remark = info?.remark || '';
              friends.push({ qq, nickname, remark });
            });
          }

          BotUtil.makeLog(
            'debug',
            `[chat.getFriendList] 好友数量: ${friends.length}`,
            'ChatStream'
          );

          return {
            success: true,
            data: { friends }
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    // 获取当前群成员列表（包含QQ号、昵称、名片、角色、是否管理员/群主）
    this.registerMCPTool('getGroupMembers', {
      description: '获取当前群成员列表（包含QQ号、昵称、名片、角色、是否管理员/群主）',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        const e = context.e;
        if (!e?.isGroup) {
          return { success: false, error: '此功能仅在群聊中可用' };
        }

        const group = e.group;
        if (!group) {
          return { success: false, error: '群对象不存在' };
        }

        try {
          // 优先使用 getMemberMap（包含完整信息）
          let memberMap = null;
          if (typeof group.getMemberMap === 'function') {
            memberMap = await group.getMemberMap();
          }

          const members = [];

          if (memberMap && typeof memberMap.forEach === 'function') {
            memberMap.forEach((info, uid) => {
              if (!uid) return;
              const qq = String(uid);
              const role = info?.role || 'member';
              const is_owner = role === 'owner';
              const is_admin = role === 'admin' || role === 'owner';
              members.push({
                qq,
                nickname: info?.nickname || '',
                card: info?.card || '',
                role,
                is_owner,
                is_admin
              });
            });
          } else if (typeof group.getMemberArray === 'function') {
            // 兼容只提供成员数组的情况
            const arr = await group.getMemberArray();
            for (const info of Array.isArray(arr) ? arr : []) {
              if (!info || info.user_id === undefined) continue;
              const qq = String(info.user_id);
              const role = info?.role || 'member';
              const is_owner = role === 'owner';
              const is_admin = role === 'admin' || role === 'owner';
              members.push({
                qq,
                nickname: info?.nickname || '',
                card: info?.card || '',
                role,
                is_owner,
                is_admin
              });
            }
          } else {
            return { success: false, error: '当前适配器不支持获取群成员列表' };
          }

          BotUtil.makeLog(
            'debug',
            `[chat.getGroupMembers] 群 ${e.group_id} 成员数量: ${members.length}`,
            'ChatStream'
          );

          return {
            success: true,
            data: { members }
          };
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

      // 群聊内存历史（仅群聊，最多保留50条）
      if (groupId && e.isGroup !== false) {
        if (!ChatStream.messageHistory.has(groupId)) {
          ChatStream.messageHistory.set(groupId, []);
        }
        const history = ChatStream.messageHistory.get(groupId);
        history.push(msgData);
        if (history.length > 50) {
          ChatStream.messageHistory.set(groupId, history.slice(-50));
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

  async buildSystemPrompt(context) {
    const { e, question } = context;
    const persona =
      question?.persona ||
      '你是在这个QQ群里的普通聊天助手，正常聊天、帮忙解决问题即可，不要刻意卖萌或重复固定话术。';
    const botRole = question?.botRole || await this.getBotRole(e);
    const dateStr = question?.dateStr || new Date().toLocaleString('zh-CN');
    
    let embeddingHint = '';
    if (this.embeddingConfig?.enabled) {
      embeddingHint = '\n💡 系统会自动检索相关历史对话（通过子服务端向量服务）\n';
    }

    const botName = e.bot?.nickname || e.bot?.info?.nickname || e.bot?.name || 'Bot';
    const isMaster = e.isMaster === true;
    
    return `人设（最高优先级，请始终遵守）：${persona}
身份：昵称=${botName}，QQ=${e.self_id}，群=${e.group_id}，角色=${botRole}${isMaster ? '（当前说话的是主人，可以稍微亲近一点，但不要过头）' : ''}
时间：${dateStr}
${embeddingHint}
说话风格：
- 正常聊天或解决问题即可，回答紧贴用户内容。
- 语言口语化、简洁，不要堆太多表情或套话。
- 听不懂用户想干嘛时，用一句话简单确认，不要连续追问很多句。
工具使用（必须遵守权限和安全）：
- 需要群管/互动（@、戳一戳、改名片、禁言、踢人、设管理员、群代办等）时，直接调用对应工具完成，不要在回复里写指令或协议。
- 修改群名片（setCard）时：
  · “把你自己改成 X”→ 修改机器人自己的名片（QQ=${e.self_id}）。
  · 明确 @ 某人或给出 QQ 时→ 修改那个人的名片。
  · “把我改成 X”→ 修改当前说话人的名片（QQ=${e.user_id}）。
- 禁言/解禁/踢人/设管理员等操作：
  · 只有在用户明确提出、且理由合理（如刷屏、骂人）时才考虑执行。
  · 如果当前机器人不是管理员或群主，只能礼貌说明权限不足，不要假装执行成功。
- 设置群代办（setGroupTodo）等对全群有影响的操作，只在用户明确要求且语义清晰时执行，避免频繁创建无意义代办。
回复要求：
- 一次回复只做当前这一轮能完成的事。
- 如果通过工具完成了操作，用很简短的话说明结果即可。
- 在任何情况下，都不要违背上面的人设和权限约束。`;
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

  async syncHistoryFromAdapter(e) {
    if (!e?.isGroup) return;
    const groupId = e.group_id;
    if (!groupId) return;

    const group = e.group;
    const getter =
      (group && typeof group.getChatHistory === 'function' && group.getChatHistory) ||
      (typeof e.getChatHistory === 'function' && e.getChatHistory) ||
      null;
    if (!getter) return;

    try {
      let rawHistory;
      try {
        // 优先使用 (message_seq, count, reverseOrder) 签名，message_seq 为空表示从最近开始
        rawHistory = await getter(undefined, 50, true);
      } catch {
        // 兼容只接受 (count) 的实现
        rawHistory = await getter(50);
      }

      const history = ChatStream.messageHistory.get(groupId) || [];
      const existingIds = new Set(
        history.map(msg => String(msg.message_id || msg.real_id || ''))
      );

      const newMessages = [];
      for (const msg of Array.isArray(rawHistory) ? rawHistory : []) {
        if (!msg || typeof msg !== 'object') continue;
        const mid = msg.real_id || msg.message_id || msg.message_seq;
        if (!mid) continue;
        const idStr = String(mid);
        if (existingIds.has(idStr)) continue;

        const sender = msg.sender || {};
        const segments = Array.isArray(msg.message) ? msg.message : [];

        let text = '';
        if (segments.length > 0) {
          text = segments.map(seg => {
            if (!seg || typeof seg !== 'object') return '';
            switch (seg.type) {
              case 'text':
                return seg.text || '';
              case 'image':
                return '[图片]';
              case 'face':
                return '[表情]';
              case 'reply':
                return `[回复:${seg.id || ''}]`;
              case 'at':
                return `@${seg.qq || seg.user_id || ''}`;
              default:
                return '';
            }
          }).join('');
        } else {
          text = msg.raw_message || '';
        }

        const nickname = sender.card || sender.nickname || '未知';
        newMessages.push({
          user_id: msg.user_id ?? sender.user_id,
          nickname,
          message: text,
          message_id: idStr,
          time: msg.time || Date.now(),
          platform: 'onebot'
        });
      }

      if (newMessages.length > 0) {
        const merged = history.concat(newMessages);
        const limited = merged.length > 50 ? merged.slice(-50) : merged;
        ChatStream.messageHistory.set(groupId, limited);

        BotUtil.makeLog(
          'debug',
          `[ChatStream.syncHistoryFromAdapter] group=${groupId}, 原有=${history.length}, 新增=${newMessages.length}, 合并后=${limited.length}`,
          'ChatStream'
        );
      }
    } catch (error) {
      BotUtil.makeLog(
        'debug',
        `[ChatStream.syncHistoryFromAdapter] 获取聊天记录失败: ${error.message}`,
        'ChatStream'
      );
    }
  }

  async mergeMessageHistory(messages, e) {
    if (!e?.isGroup || messages.length < 2) {
      return messages;
    }

    // 每次构建上下文前，同步一次外部聊天记录到内存缓存
    await this.syncHistoryFromAdapter(e);

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
    let StreamLoader = null;
    
    try {
      // 构建消息上下文
      if (!Array.isArray(messages)) {
        messages = await this.buildChatContext(e, messages);
      }
      messages = await this.mergeMessageHistory(messages, e);
      const query = Array.isArray(messages) ? this.extractQueryFromMessages(messages) : messages;
      messages = await this.buildEnhancedContext(e, query, messages);
      
      // 在调用 AI 之前，挂载当前事件，供 MCP 工具在本轮对话中获取上下文（群/私聊信息）
      try {
        StreamLoader = (await import('#infrastructure/aistream/loader.js')).default;
        if (StreamLoader) {
          StreamLoader.currentEvent = e || null;
          BotUtil.makeLog(
            'debug',
            `[ChatStream.execute] 设置当前事件: isGroup=${e?.isGroup}, message_type=${e?.message_type}, group_id=${e?.group_id}, user_id=${e?.user_id}`,
            'ChatStream'
          );
        }
      } catch {
        StreamLoader = null;
      }
      
      // 打印给 LLM 的消息概要，便于调试 Prompt 结构（只截取前几百字符，避免刷屏）
      try {
        const preview = (messages || []).map((m, idx) => {
          const role = m.role || `msg${idx}`;
          let content = m.content;
          if (typeof content === 'object') {
            const text = content.text || content.content || '';
            content = text;
          }
          return {
            idx,
            role,
            text: String(content ?? '')
          };
        });
        BotUtil.makeLog(
          'debug',
          `[ChatStream.execute] LLM消息预览: ${JSON.stringify(preview, null, 2)}`,
          'ChatStream'
        );
      } catch {
        // 调试日志失败直接忽略
      }
      
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
    } finally {
      // 清理当前事件，避免影响其他工作流/请求
      if (StreamLoader && StreamLoader.currentEvent === e) {
        StreamLoader.currentEvent = null;
      }
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
    for (const [groupId, messages] of ChatStream.messageHistory.entries()) {
      if (!messages || messages.length === 0) {
        ChatStream.messageHistory.delete(groupId);
        continue;
      }
      // 始终只保留最近50条消息
      if (messages.length > 50) {
        ChatStream.messageHistory.set(groupId, messages.slice(-50));
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