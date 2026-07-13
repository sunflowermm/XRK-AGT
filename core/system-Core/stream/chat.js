import path from 'path';
import fs from 'fs';
import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';
import { PARSEABLE_EMOTIONS, QQ_EMOJI_REACTION_IDS, EMOJI_REACTION_TYPES } from '#utils/emotion-utils.js';
import {
  actionAck,
  createUserVisibleTurnState,
  formatReplyQueuedAck,
  formatSessionWhere,
  formatUserVisibleDuplicateAck,
  formatUserVisibleSentAck,
  isOverlappingUserVisible
} from '#utils/chat-user-visible-ack.js';
import { withStreamLoaderEvent } from '#infrastructure/aistream/stream-loader-context.js';
import {
  getStreamRequestContext,
  runWithStreamRequestContext
} from '#infrastructure/aistream/stream-request-context.js';
import { assembleChatLlmMessages, logLlmMessagePreview } from '#infrastructure/aistream/chat-pipeline.js';
import { BaseTools } from '#utils/base-tools.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import { resolveConfiguredWorkspace } from '../lib/ai-workspace-runtime.js';
import {
  buildOutboundSegments,
  contentHasGroupAt,
  replyContentForbidden,
  resolveOutgoingMessage,
  splitProtocolParts,
} from '#utils/chat-reply-protocol.js';

const EMOTIONS_DIR = path.join(process.cwd(), 'resources/aiimages');
const IMAGE_SEND_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

function randomRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 聊天工作流：群聊/互动/群管 MCP 工具 */
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
        frequencyPenalty: 0.6,
        /** 多工具同轮时顺序执行，避免 reply 与其它 MCP 抢跑 */
        parallel_tool_calls: false
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
    for (const emotion of PARSEABLE_EMOTIONS) {
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
   * 检查是否为群聊环境
   * @param {Object} context - 上下文对象
   * @returns {Object|null} 如果不是群聊返回错误对象，否则返回null
   */
  _requireGroup(context) {
    if (!context.e?.isGroup) {
      return { success: false, error: '非群聊环境' };
    }
    return null;
  }

  _getTurnState(context) {
    const turn = context?.turnState ?? getStreamRequestContext()?.turnState;
    if (turn) return turn;
    BotUtil.makeLog('warn', '[ChatStream] 无请求级 turnState，reply 队列可能串线', 'ChatStream');
    return createUserVisibleTurnState();
  }

  /**
   * 统一错误处理包装器
   * @param {Function} fn - 要执行的异步函数
   * @param {number} [delay=300] - 执行后的延迟（毫秒）
   * @returns {Promise<Object>} 返回结果对象
   */
  async _wrapHandler(fn, delay = 300) {
    try {
      const result = await fn();
      if (delay > 0) await BotUtil.sleep(delay);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _chatWorkspaceAbs() {
    const fileCfg = getAistreamConfigOptional().tools?.file ?? {};
    return resolveConfiguredWorkspace(fileCfg.workspace);
  }

  /** 解析工作区内文件路径（send_file / send_image） */
  _resolveWorkspaceFile(_context, filePath, { requireImage = false, rejectImage = false } = {}) {
    const rel = String(filePath ?? '').trim();
    if (!rel) return { error: 'filePath 不能为空' };
    const baseTools = new BaseTools(this._chatWorkspaceAbs());
    let absPath;
    try {
      absPath = baseTools.resolvePath(rel);
    } catch (err) {
      return { error: err.message || '路径无效' };
    }
    if (!fs.existsSync(absPath)) return { error: `文件不存在: ${rel}` };
    const ext = path.extname(absPath).toLowerCase();
    if (requireImage && !IMAGE_SEND_EXTS.has(ext)) {
      return { error: '非图片文件，请用 send_file' };
    }
    if (rejectImage && IMAGE_SEND_EXTS.has(ext)) {
      return { error: '图片请用 send_image' };
    }
    return { absPath, displayName: path.basename(absPath) };
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
      description:
        '群聊中 @ 指定成员（仅发送 @ 段，正文仍由你生成）。参数 qq 为对方账号。非群聊不可用。',
      inputSchema: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '要@的用户QQ号（必填）。例如："123456789"。必须是群内的成员QQ号。'
          }
        },
        required: ['qq']
      },
      handler: async (args = {}, context = {}) => {
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;

        const qq = String(args.qq || '').trim();
        if (!qq) {
          return { success: false, error: 'QQ号不能为空' };
        }

        return this._wrapHandler(async () => {
          const seg = segment;
          await context.e.reply([seg.at(qq)]);
          const where = formatSessionWhere(context.e);
          return {
            success: true,
            raw: formatUserVisibleSentAck(where, `@${qq}`)
          };
        }, 200);
      },
      enabled: true
    });

    /**
     * 戳一戳（群成员/好友/设备用户）
     * 群聊走 group.pokeMember；私聊走 reply({ type:'poke', qq }) 或好友 API；设备/Web 走 reply 下发给前端展示。
     */
    this.registerMCPTool('poke', {
      description: '戳一戳对方（QQ 系统戳一戳，用户可见）。群聊戳成员，私聊戳好友。qq 不填则当前说话人。禁止用文字 *戳戳* 代替本工具。',
      inputSchema: {
        type: 'object',
        properties: {
          qq: { type: 'string', description: '要戳的对象QQ/用户ID（可选，默认当前用户）' }
        },
        required: []
      },
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        if (!e) return { success: false, error: '缺少事件上下文' };
        const targetQq = String(args.qq || e.user_id || e.device_id || '').trim();
        if (!targetQq) return { success: false, error: '无法确定要戳的对象' };

        return this._wrapHandler(async () => {
          const where = formatSessionWhere(e);
          if (e.isGroup === true && e.group?.pokeMember) {
            await e.group.pokeMember(targetQq);
          } else if (e.friend?.poke && String(e.user_id) === targetQq) {
            await e.friend.poke();
          } else if (e.bot?.sendApi) {
            const qqNum = parseInt(targetQq, 10);
            const params = e.group_id != null
              ? { group_id: e.group_id, user_id: qqNum }
              : { user_id: qqNum };
            await e.bot.sendApi('send_poke', params);
          } else if (typeof e.reply === 'function') {
            await e.reply({ type: 'poke', qq: targetQq });
          } else {
            return { success: false, error: '当前环境不支持戳一戳' };
          }
          return { success: true, raw: actionAck(`你已对 ${targetQq} 戳一戳（${where}）`) };
        });
      },
      enabled: true
    });

    this.registerMCPTool('emotion', {
      description: `发表情包图片（resources/aiimages 随机一张）。emotionType：${PARSEABLE_EMOTIONS.join('、')}。用户只要表情时不要再用 reply 附文字模拟。`,
      inputSchema: {
        type: 'object',
        properties: {
          emotionType: { type: 'string', enum: PARSEABLE_EMOTIONS },
          text: { type: 'string', description: '可选附言' },
        },
        required: ['emotionType'],
      },
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        if (!e?.reply) return { success: false, error: '当前环境无法发送' };
        const t = String(args.emotionType ?? '').trim();
        if (!PARSEABLE_EMOTIONS.includes(t)) return { success: false, error: '无效表情类型' };
        const image = this.getRandomEmotionImage(t);
        if (!image) return { success: false, error: `暂无「${t}」表情包资源` };
        return this._wrapHandler(async () => {
          const text = String(args.text ?? '').trim();
          if (text) {
            const forbidden = replyContentForbidden(text);
            if (forbidden) return { success: false, error: forbidden };
            const { replyId, segments } = resolveOutgoingMessage(text, { fallbackReplyId: null });
            const payload = buildOutboundSegments({ replyId, imagePaths: [image], segments });
            await e.reply(payload);
          } else {
            await e.reply(segment.image(image));
          }
          const where = formatSessionWhere(e);
          this.recordAIResponse(e, `[表情:${t}]${text ? ` ${text}` : ''}`);
          return { success: true, raw: actionAck(`你已在${where}发送「${t}」表情包`) };
        });
      },
      enabled: true,
    });

    this.registerMCPTool('send_file', {
      description: '向当前会话发送非图片类文件（文档、压缩包等）。filePath 为工作区内相对路径；图片请用 send_image。',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '工作区内文件路径' },
          name: { type: 'string', description: '可选，客户端显示的文件名' },
        },
        required: ['filePath'],
      },
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        const resolved = this._resolveWorkspaceFile(context, args.filePath, { rejectImage: true });
        if (resolved.error) return { success: false, error: resolved.error };
        return this._wrapHandler(async () => {
          const displayName = String(args.name ?? resolved.displayName).trim() || resolved.displayName;
          const sender = e?.group_id ? e.group : e?.friend;
          if (!sender?.sendFile) {
            return { success: false, error: '当前环境不支持发送文件' };
          }
          await sender.sendFile(resolved.absPath, displayName);
          const where = formatSessionWhere(e);
          this.recordAIResponse(e, `[文件:${displayName}]`);
          return { success: true, raw: actionAck(`你已在${where}发送文件「${displayName}」`) };
        });
      },
      enabled: true,
    });

    this.registerMCPTool('send_image', {
      description: '向当前会话发送工作区内的图片（PNG/JPG/GIF 等）。filePath 为工作区相对路径；内置表情包用 emotion。',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '工作区内图片路径' },
          messageId: { type: 'string', description: '可选，回复某条消息 ID' },
        },
        required: ['filePath'],
      },
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        const resolved = this._resolveWorkspaceFile(context, args.filePath, { requireImage: true });
        if (resolved.error) return { success: false, error: resolved.error };
        if (!e?.reply) return { success: false, error: '当前环境无法发送消息' };
        return this._wrapHandler(async () => {
          const mid = args.messageId != null ? String(args.messageId).trim() : '';
          const payload = [];
          if (mid) payload.push({ type: 'reply', id: mid });
          payload.push(segment.image(resolved.absPath));
          await e.reply(payload);
          const where = formatSessionWhere(e);
          this.recordAIResponse(e, `[图片:${resolved.displayName}]`);
          return { success: true, raw: actionAck(`你已在${where}发送图片「${resolved.displayName}」`) };
        });
      },
      enabled: true,
    });

    this.registerMCPTool('reply', {
      description: '拟定文字回复（本轮 tool 轮结束后由框架统一发到 QQ）。content：| 分句；[回复:消息ID] 引用（可省略，默认引用 [当前消息]）；群聊 [at:数字QQ]。禁止 @QQ/@昵称，发表情用 emotion。',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '正文（必填）' },
          messageId: { type: 'string', description: '可选，显式引用消息 ID（一般不必填）' },
        },
        required: ['content']
      },
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        const turn = this._getTurnState(context);
        const rawContent = String(args.content ?? '').trim();
        if (!rawContent) return { success: false, error: 'content 不能为空' };

        const forbidden = replyContentForbidden(rawContent);
        if (forbidden) return { success: false, error: forbidden };
        if (contentHasGroupAt(rawContent) && !e?.isGroup) {
          return { success: false, error: '[at:QQ] 仅群聊可用' };
        }

        const explicitMid = args.messageId != null ? String(args.messageId).trim() : '';
        const fallbackId = explicitMid || ChatStream.resolveEventMessageId(e);
        const { replyId, displayText } = resolveOutgoingMessage(rawContent, {
          fallbackReplyId: fallbackId
        });
        const where = formatSessionWhere(e);
        if (turn.queuedReplyContent) {
          const prev = resolveOutgoingMessage(turn.queuedReplyContent, {
            fallbackReplyId: turn.queuedReplyMessageId
          }).displayText;
          if (isOverlappingUserVisible(displayText, prev)) {
            return {
              success: true,
              raw: formatUserVisibleDuplicateAck(where, `回复「${prev}」`, 'reply')
            };
          }
        }
        turn.queuedReplyContent = rawContent;
        turn.queuedReplyMessageId = replyId;
        return {
          success: true,
          raw: formatReplyQueuedAck(where, displayText, replyId)
        };
      },
      enabled: true
    });

    this.registerMCPTool('emojiReaction', {
      description: '对群消息进行表情回应。支持：开心、惊讶、伤心、大笑、害怕、喜欢、爱心、生气。不指定 msgId 时选最近一条他人消息。仅群聊。',
      inputSchema: {
        type: 'object',
        properties: {
          msgId: { type: 'string', description: '要回应的消息 ID（可选）' },
          emojiType: {
            type: 'string',
            description: '表情类型',
            enum: EMOJI_REACTION_TYPES,
          },
        },
        required: ['emojiType'],
      },
      handler: async (args = {}, context = {}) => {
        const e = context.e;
        if (!e?.isGroup) return { success: false, error: '非群聊环境' };

        const typeMap = { like: '喜欢', love: '爱心', laugh: '大笑', wow: '惊讶', sad: '伤心', angry: '生气' };
        let emojiType = typeMap[args.emojiType] ?? args.emojiType;

        const emojiIds = QQ_EMOJI_REACTION_IDS[emojiType];
        if (!emojiIds?.length) return { success: false, error: '无效表情类型' };

        let msgId = String(args.msgId ?? '').trim();
        if (!msgId) {
          const historyKey = ChatStream.getEventHistoryKey(e);
          const history = historyKey ? (ChatStream.messageHistory.get(historyKey) || []) : [];
          const last = [...history].reverse().find(
            (m) => String(m.user_id) !== String(e.self_id) && m.message_id,
          );
          if (last) msgId = String(last.message_id);
        }
        if (!msgId) return { success: false, error: '找不到可回应的消息 ID' };

        const emojiId = Number(emojiIds[Math.floor(Math.random() * emojiIds.length)]);
        try {
          if (e.group?.setEmojiLike) {
            const result = await e.group.setEmojiLike(msgId, emojiId, true);
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
      enabled: true,
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        const thumbCount = Math.min(parseInt(args.count) || 1, 50);
          const member = context.e.group?.pickMember(args.qq);
        if (!member || typeof member.thumbUp !== 'function') {
          return { success: false, error: '点赞功能不可用' };
        }

        return this._wrapHandler(async () => {
          await member.thumbUp(thumbCount);
          return { success: true, message: '点赞成功', data: { qq: args.qq, count: thumbCount } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.sign();
          return { success: true, message: '签到成功' };
        });
      },
      enabled: true
    });

    this.registerMCPTool('mute', {
      description: '禁言群成员。需要管理员或群主权限。仅群聊环境可用。',
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.muteMember(args.qq, args.duration);
          return { success: true, message: '禁言成功', data: { qq: args.qq, duration: args.duration } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.muteMember(args.qq, 0);
          return { success: true, message: '解禁成功', data: { qq: args.qq } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.muteAll(true);
          return { success: true, message: '全员禁言成功' };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.muteAll(false);
          return { success: true, message: '解除全员禁言成功' };
        });
      },
      enabled: true
    });

    this.registerMCPTool('setCard', {
      description: '修改群名片。未指定QQ号时默认修改机器人自己的名片。需要管理员或群主权限。仅群聊环境可用。',
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
          const e = context.e;
          let targetQq = String(args.qq || '').trim();
          if (!targetQq) {
            targetQq = String(e.self_id || e.bot?.uin || '').trim() || String(e.user_id || '').trim();
          }
          if (!targetQq) {
            return { success: false, error: '无法确定要修改名片的成员QQ号' };
          }

        return this._wrapHandler(async () => {
          await context.e.group.setCard(targetQq, args.card);
          return { success: true, message: '修改名片成功', data: { qq: targetQq, card: args.card } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.setName(args.name);
          return { success: true, message: '修改群名成功', data: { name: args.name } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.setAdmin(args.qq, true);
          return { success: true, message: '设置管理员成功', data: { qq: args.qq } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.setAdmin(args.qq, false);
          return { success: true, message: '取消管理员成功', data: { qq: args.qq } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.setTitle(args.qq, args.title, args.duration || -1);
          return { success: true, message: '设置头衔成功', data: { qq: args.qq, title: args.title } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          await context.e.group.kickMember(args.qq, args.reject || false);
          return { success: true, message: '踢出成员成功', data: { qq: args.qq } };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        const msgId = String(args.msgId ?? '').trim();
        if (!msgId) {
          return { success: false, error: '消息ID不能为空' };
        }
        
        return this._wrapHandler(async () => {
          const group = context.e.group;
          if (group && typeof group.setEssenceMessage === 'function') {
            await group.setEssenceMessage(msgId);
            return { success: true, message: '设置精华成功', data: { msgId } };
          } else if (context.e.bot?.sendApi) {
            await context.e.bot.sendApi('set_essence_msg', { message_id: msgId });
            return { success: true, message: '设置精华成功', data: { msgId } };
          }
          return { success: false, error: 'API不可用' };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        const msgId = String(args.msgId ?? '').trim();
        if (!msgId) {
          return { success: false, error: '消息ID不能为空' };
        }
        
        return this._wrapHandler(async () => {
          const group = context.e.group;
          if (group && typeof group.removeEssenceMessage === 'function') {
            await group.removeEssenceMessage(msgId);
            return { success: true, message: '取消精华成功', data: { msgId } };
          }
          return { success: false, error: 'API不可用' };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        const content = String(args.content ?? '').trim();
        if (!content) {
          return { success: false, error: '公告内容不能为空' };
        }
        
        return this._wrapHandler(async () => {
          const group = context.e.group;
          const image = args.image ? String(args.image).trim() : undefined;
          
          if (group && typeof group.sendNotice === 'function') {
            const result = await group.sendNotice(content, image ? { image } : {});
            if (result !== undefined) {
              return { success: true, message: '发送群公告成功', data: { content } };
            }
          } else if (context.e.bot?.sendApi) {
            const apiParams = { group_id: context.e.group_id, content };
            if (image) apiParams.image = image;
            const result = await context.e.bot.sendApi('_send_group_notice', apiParams);
            if (result?.status === 'ok') {
              return { success: true, message: '发送群公告成功', data: { content } };
            }
          }
          return { success: false, error: 'API不可用' };
        });
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
          
          if (!canRecall) {
            return { success: false, error: '无法撤回消息' };
          }

          return this._wrapHandler(async () => {
            if (context.e.isGroup && context.e.group) {
              await context.e.group.recallMsg(args.msgId);
            } else if (context.e.bot) {
              await context.e.bot.sendApi('delete_msg', { message_id: args.msgId });
            }
            return { success: true, message: '消息撤回成功', data: { msgId: args.msgId } };
          });
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      enabled: true
    });

    this.registerMCPTool('getGroupInfoEx', {
      description: '获取当前群扩展信息（如 getInfoEx）。仅群聊。',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          const group = context.e.group;
          if (group && typeof group.getInfoEx === 'function') {
            const info = await group.getInfoEx();
            BotUtil.makeLog('debug', `获取群信息ex成功: ${JSON.stringify(info)}`, 'ChatStream');
            return { success: true, data: info };
          }
          return { success: false, error: 'API不可用' };
        }, 0).catch(error => {
          BotUtil.makeLog('warn', `获取群信息ex失败: ${error.message}`, 'ChatStream');
          return { success: false, error: error.message };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          const group = context.e.group;
          if (group && typeof group.getAtAllRemain === 'function') {
            const remain = await group.getAtAllRemain();
            BotUtil.makeLog('debug', `@全体成员剩余次数: ${JSON.stringify(remain)}`, 'ChatStream');
            return { success: true, data: remain };
          }
          return { success: false, error: 'API不可用' };
        }, 0).catch(error => {
          BotUtil.makeLog('warn', `获取@全体剩余次数失败: ${error.message}`, 'ChatStream');
          return { success: false, error: error.message };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        return this._wrapHandler(async () => {
          const group = context.e.group;
          if (group && typeof group.getBanList === 'function') {
            const banList = await group.getBanList();
            BotUtil.makeLog('debug', `群禁言列表: ${JSON.stringify(banList)}`, 'ChatStream');
            return { success: true, data: banList };
          }
          return { success: false, error: 'API不可用' };
        }, 0).catch(error => {
          BotUtil.makeLog('warn', `获取禁言列表失败: ${error.message}`, 'ChatStream');
          return { success: false, error: error.message };
        });
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
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;
        
        const msgId = String(args.msgId ?? '').trim();
        if (!msgId) {
          return { success: false, error: '消息ID不能为空' };
        }
        
        return this._wrapHandler(async () => {
          const e = context.e;
          const botRole = await this.getBotRole(e);
          const isAdmin = botRole === '管理员' || botRole === '群主';
          if (!isAdmin) {
            return { success: false, error: '需要管理员或群主权限才能设置群代办' };
          }

          if (e.bot?.sendApi) {
            const result = await e.bot.sendApi('set_group_todo', {
              group_id: e.group_id,
              message_id: msgId
            });
            if (result !== undefined) {
              return { success: true, message: '设置群代办成功', data: { msgId } };
            }
          }
          return { success: false, error: 'API不可用' };
        });
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

    this.registerMCPTool('getGroupMembers', {
      description: '列出当前群成员（qq、昵称、名片、角色等）。仅群聊。',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (_args = {}, context = {}) => {
        const groupCheck = this._requireGroup(context);
        if (groupCheck) return groupCheck;

        const group = context.e.group;
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
   * 记录消息到历史，统一使用 getEventHistoryKey 作为 key，群聊/私聊/设备互不冲突；最多保留 50 条。
   */
  recordMessage(e) {
    if (!e) return;
    const historyKey = ChatStream.getEventHistoryKey(e);
    if (!historyKey) return;
    try {
      let message = '';
      if (e.raw_message) message = e.raw_message;
      else if (e.msg) message = e.msg;
      else if (e.message) {
        if (typeof e.message === 'string') message = e.message;
        else if (Array.isArray(e.message)) {
          message = e.message.map(seg => {
            if (!seg || typeof seg !== 'object') return '';
            switch (seg.type) {
              case 'text': return seg.text || '';
              case 'image': return '[图片]';
              case 'at': return `@${seg.qq || seg.user_id || ''}`;
              case 'reply': return `[回复:${seg.id || ''}]`;
              default: return '';
            }
          }).join('');
        }
      } else if (e.content) message = typeof e.content === 'string' ? e.content : (e.content?.text ?? '');

      const userId = e.user_id ?? e.userId ?? e.user?.id ?? e.sender?.user_id ?? null;
      const nickname = e.sender?.card || e.sender?.nickname || e.user?.name || e.user?.nickname || e.from?.name || '未知';
      let messageId = e.message_id ?? e.real_id ?? e.messageId ?? e.id ?? e.source?.id ?? ChatStream.getReplySegmentId(e);
      if (!messageId) {
        messageId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
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
        platform: e.isDevice ? 'device' : 'onebot'
      };

      if (!ChatStream.messageHistory.has(historyKey)) ChatStream.messageHistory.set(historyKey, []);
      const history = ChatStream.messageHistory.get(historyKey);
      history.push(msgData);
      if (history.length > 50) ChatStream.messageHistory.set(historyKey, history.slice(-50));

      if (this.embeddingConfig?.enabled && message && message.length > 5) {
        this.storeMessageMemory(historyKey, msgData).catch(() => {});
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
      platform: e.isDevice ? 'device' : 'onebot'
    };
    
    const historyKey = ChatStream.getEventHistoryKey(e);
    if (historyKey) {
      const history = ChatStream.messageHistory.get(historyKey) || [];
      history.push(msgData);
      if (history.length > 50) history.shift();
      ChatStream.messageHistory.set(historyKey, history);
    }
    if (this.embeddingConfig?.enabled && historyKey)
      this.storeMessageMemory(historyKey, msgData).catch(() => {});
  }

  async buildSystemPrompt(context) {
    const { e, question } = context;
    const persona =
      question?.persona ||
      '你是群里一起聊天的伙伴：像真人一样接话，听得懂玩笑和气氛，该正经说清、该闲聊就短打。';
    const botName = e?.bot?.nickname || e?.bot?.info?.nickname || e?.bot?.name || 'Bot';

    const lines = [
      `# ${botName}`,
      persona,
      '',
      '## 对用户说话（须调 MCP，勿用文字假装）',
      '- **reply**：当前会话文字。`|` 分句 · `[回复:消息ID]`（可省略，默认引用 [当前消息]）· 群聊 `[at:数字QQ]`',
      '- **poke**：戳一戳；用户说「戳我/戳一下」必须调用',
      '- **emotion** / **send_image**：表情包或工作区图片',
      '- **send_file**：工作区非图片文件',
      '- **emojiReaction**：群消息表情回应',
      '- **tools.***（已合并）：工作区 read/write/run 等',
      '- 禁止 `@QQ`/`@昵称`；无权限或失败时如实说明',
      '- 工具回执说明已拟定/已发出；用户已能看到后不要重复 reply',
      '- 只回答 `[当前消息]`，勿复读整段群聊记录',
      '',
      '## 记录',
      '- `昵称(QQ)[ID:xxx]` 为消息 ID，引用他人发言写 `[回复:xxx]`',
      '',
      '## 工作区与 skills',
      '- 「Workspace context」含 AGENTS / rules / **skills**（按 `<location>` 用 tools.read 加载 SKILL.md）',
      '- 工作区根目录与 tools 流一致；发文件前确认路径存在',
    ];

    return this.finalizeSystemPromptContent(lines.join('\n'));
  }

  /** 动态轮次上下文（独立 user 消息，不污染可缓存的 system 前缀） */
  _buildVolatileTurnContext(e, question) {
    if (!e) return '';
    const dateStr = question?.dateStr || new Date().toLocaleString('zh-CN');
    const botName = e.bot?.nickname || e.bot?.info?.nickname || e.bot?.name || 'Bot';
    const botRole = question?.botRole || '';
    const sessionLine = e.isGroup && e.group_id
      ? `${botName}｜QQ ${e.self_id}｜群 ${e.group_id}${botRole ? `｜${botRole}` : ''}`
      : `${botName}｜QQ ${e.self_id}｜私聊 ${e.user_id}`;
    const parts = [`会话：${sessionLine}`, `当前时间：${dateStr}`];
    if (e.isMaster === true) parts.push('当前发言者为主人，指令优先、少反驳。');
    if (question?.isGlobalTrigger) parts.push('【随机旁观】你闲来无事看群聊，自然接话即可，不必解决问题。');
    return `【本轮上下文】\n${parts.join('\n')}`;
  }

  async buildEnhancedContext(e, question, messages) {
    const enhanced = [...messages];
    const ctx = question && typeof question === 'object' ? { ...question } : {};
    if (e && ctx.botRole == null) {
      ctx.botRole = await this.getBotRole(e);
    }
    const volatile = this._buildVolatileTurnContext(e, ctx);
    if (volatile) {
      enhanced.splice(1, 0, { role: 'user', content: volatile });
    }
    return enhanced;
  }

  async _extractImagesFromEvent(e) {
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
          const ref = seg.file || seg.url || seg.data?.file || seg.data?.url;
          if (!ref) continue;
          if (inReplyRegion) {
            replyImages.push(ref);
          } else {
            images.push(ref);
          }
        }
      }
    }

    if (typeof e?.getReply === 'function') {
      try {
        const reply = await e.getReply();
        if (reply && Array.isArray(reply.message)) {
          for (const seg of reply.message) {
            if (seg.type === 'image') {
              const ref = seg.file || seg.url || seg.data?.file || seg.data?.url;
              if (ref) replyImages.push(ref);
            }
          }
        }
      } catch (err) {
        Bot.makeLog('debug', `[ChatStream] _extractImagesFromEvent 获取被回复图片失败: ${err?.message}`, 'ChatStream');
      }
    }

    return { images, replyImages };
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

    const isGlobalTrigger = !!(question && typeof question === 'object' && question.isGlobalTrigger);
    const { images, replyImages } = await this._extractImagesFromEvent(e);

    if (images.length === 0 && replyImages.length === 0) {
      messages.push({
        role: 'user',
        content: isGlobalTrigger ? { text, isGlobalTrigger: true } : text,
      });
    } else {
      messages.push({
        role: 'user',
        content: {
          text: text || '',
          images,
          replyImages,
          ...(isGlobalTrigger ? { isGlobalTrigger: true } : {}),
        },
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

  /**
   * 统一：根据事件得到历史缓存的 key（群=group_id，设备=device_${device_id}，私聊=private_${user_id}）
   */
  static getEventHistoryKey(e) {
    if (!e) return null;
    if (e.isGroup === true && e.group_id != null) return String(e.group_id);
    if (e.isDevice === true && e.device_id) return `device_${e.device_id}`;
    if (e.user_id != null) return `private_${e.user_id}`;
    return null;
  }

  /**
   * 从事件消息段中取“被回复消息”的 id（与 e.getReply() 同源，仅同步取 id）
   * 插件需完整内容/媒体时请用 e.getReply()。
   */
  static getReplySegmentId(e) {
    const seg = e?.message && Array.isArray(e.message) ? e.message.find(s => s && s.type === 'reply') : null;
    return seg?.id ?? seg?.data?.id ?? null;
  }

  /** 当前触发消息的消息 ID（[当前消息] 行里的 ID） */
  static resolveEventMessageId(e) {
    if (!e) return null;
    const id = e.message_id ?? e.real_id ?? e.messageId ?? e.id ?? e.source?.id ?? ChatStream.getReplySegmentId(e);
    const s = id != null ? String(id).trim() : '';
    return s || null;
  }

  /**
   * 统一：解析事件的聊天历史来源，供 syncHistoryFromAdapter / mergeMessageHistory 使用
   * @returns {{ historyKey: string, getter: function } | null}
   */
  getHistorySource(e) {
    const historyKey = ChatStream.getEventHistoryKey(e);
    if (!historyKey) return null;
    const getter =
      (e?.group && typeof e.group.getChatHistory === 'function' && e.group.getChatHistory) ||
      (typeof e?.getChatHistory === 'function' && e.getChatHistory) ||
      null;
    if (!getter) return null;
    return { historyKey, getter };
  }

  async syncHistoryFromAdapter(e) {
    const source = this.getHistorySource(e);
    if (!source) return;
    const { historyKey, getter } = source;

    try {
      let rawHistory;
      try {
        // 优先使用 (message_seq, count, reverseOrder) 签名，message_seq 为空表示从最近开始
        rawHistory = await getter(undefined, 50, true);
      } catch {
        // 兼容只接受 (count) 的实现
        rawHistory = await getter(50);
      }

      const history = ChatStream.messageHistory.get(historyKey) || [];
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

        const nickname = sender.card || sender.nickname || msg.nickname || '未知';
        newMessages.push({
          user_id: msg.user_id ?? sender.user_id,
          nickname,
          message: text,
          message_id: idStr,
          time: msg.time || Date.now(),
          platform: e.isDevice ? 'device' : 'onebot'
        });
      }

      if (newMessages.length > 0) {
        const merged = history.concat(newMessages);
        const limited = merged.length > 50 ? merged.slice(-50) : merged;
        ChatStream.messageHistory.set(historyKey, limited);

        BotUtil.makeLog(
          'debug',
          `[ChatStream.syncHistoryFromAdapter] key=${historyKey}, 原有=${history.length}, 新增=${newMessages.length}, 合并后=${limited.length}`,
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
    if (!e || messages.length < 2) return messages;
    const source = this.getHistorySource(e);
    if (!source) return messages;

    await this.syncHistoryFromAdapter(e);

    const { historyKey } = source;
    const history = ChatStream.messageHistory.get(historyKey) || [];
    const userMessage = messages[messages.length - 1];
    const isGlobalTrigger = e.isGroup === true && (userMessage.content?.isGlobalTrigger || false);

    const mergedMessages = [messages[0]];
    const currentMsgId = e.message_id || e.real_id || e.messageId || e.id || e.source?.id || '未知';
    const currentUserNickname = e.sender?.card || e.sender?.nickname || e.user?.name || '用户';
    const currentContent = typeof userMessage.content === 'string'
      ? userMessage.content
      : (userMessage.content?.text ?? '');

    const formatMessage = (msg) => {
      const msgId = msg.message_id || msg.real_id || '未知';
      return `${msg.nickname}(${msg.user_id})[ID:${msgId}]: ${msg.message}`;
    };

    const filteredHistory = history.filter(msg =>
      String(msg.message_id) !== String(currentMsgId)
    );
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

    const sectionLabel = String(historyKey).startsWith('device_') ? '[近期对话]' : '[群聊记录]';
    if (isGlobalTrigger) {
      const recentMessages = uniqueHistory.slice(-15);
      if (recentMessages.length > 0) {
        mergedMessages.push({
          role: 'user',
          content: `${sectionLabel}\n${recentMessages.map(formatMessage).join('\n')}\n\n你闲来无事点开群聊，看到这些发言。请根据你的个性和人设，自然地表达情绪和感受，不要试图解决问题。`
        });
      }
    } else {
      const recentMessages = uniqueHistory.slice(-10);
      
      // 分别显示历史记录和当前消息
      if (recentMessages.length > 0) {
        mergedMessages.push({
          role: 'user',
          content: `${sectionLabel}\n${recentMessages.map(formatMessage).join('\n')}`
        });
      }
      
      // 当前消息：有 ID 时加 [当前消息] 前缀，否则保留多模态结构
      if (!currentContent) {
        // no-op
      } else if (typeof userMessage.content === 'object' && userMessage.content !== null && userMessage.content.text) {
        const content = userMessage.content;
        const prefix = currentMsgId !== '未知' ? `[当前消息]\n${currentUserNickname}(${e.user_id})[ID:${currentMsgId}]: ` : '';
        mergedMessages.push({
          role: 'user',
          content: {
            text: prefix ? `${prefix}${content.text || content.content || currentContent}` : (content.text || currentContent),
            images: content.images || [],
            replyImages: content.replyImages || []
          }
        });
      } else if (currentMsgId !== '未知') {
        mergedMessages.push({
          role: 'user',
          content: `[当前消息]\n${currentUserNickname}(${e.user_id})[ID:${currentMsgId}]: ${currentContent}`
        });
      } else {
        mergedMessages.push(userMessage);
      }
    }
    
    return mergedMessages;
  }

  /** 合并 LLM 正文与 reply 工具拟定内容（有拟定则始终以拟定为准，忽略 LLM 收尾摘要） */
  _resolveOutboundText(llmText, turn) {
    const queued = String(turn?.queuedReplyContent ?? '').trim();
    if (queued) return queued;
    return (llmText ?? '').toString().trim();
  }

  async execute(e, question, config) {
    return runWithStreamRequestContext({ e, turnState: createUserVisibleTurnState() }, () =>
      withStreamLoaderEvent(e, async () => {
        try {
          if (e) this.recordMessage(e);

          const messages = await assembleChatLlmMessages(this, e, question);
          logLlmMessagePreview(this, messages, 'ChatStream');

          const turn = getStreamRequestContext()?.turnState;
          const aiResult = await this.callAI(messages, config);
          if (!aiResult) return null;

          const trimmed = this._resolveOutboundText(aiResult.content, turn);
          if (trimmed) {
            const fallbackReplyId = turn?.queuedReplyMessageId ?? ChatStream.resolveEventMessageId(e);
            await this.sendMessages(e, trimmed, aiResult.executedToolNames ?? [], { fallbackReplyId });
            const { displayText } = resolveOutgoingMessage(trimmed, { fallbackReplyId });
            const historyText = displayText || trimmed;
            this.recordAIResponse(e, historyText, aiResult.executedToolNames ?? []);
            if (turn) turn.lastOutboundSummary = historyText;
          }
          return trimmed || '';
        } catch (error) {
          BotUtil.makeLog('error', `工作流执行失败[${this.name}]: ${error.message}`, 'ChatStream');
          return null;
        }
      })
    );
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
    
    const emotionGroup = PARSEABLE_EMOTIONS.join('|');
    const combinedPattern = new RegExp(`(\\[CQ:[^\\]]+\\]|\\[(${emotionGroup})\\])`, 'g');
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
          const seg = segment;
          segments.push(seg.image(image));
        }
      } else if (marker.content.startsWith('[CQ:')) {
        // CQ码
        const cqMatch = marker.content.match(/\[CQ:(\w+)(?:,([^\]]+))?\]/);
        if (cqMatch) {
          const [, type, params] = cqMatch;
          const paramObj = {};
          const seg = segment;
          
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
                const atHistoryKey = ChatStream.getEventHistoryKey(e);
                if (atHistoryKey) {
                  const history = ChatStream.messageHistory.get(atHistoryKey) || [];
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

  async sendMessages(e, cleanText, executedToolNames = [], { fallbackReplyId = null, replyFallbackOnAllParts = true } = {}) {
    if (!cleanText?.trim() || !e?.reply) return;

    const toolPrefix = executedToolNames.length > 0
      ? `［使用了: ${executedToolNames.join('、')}］ `
      : '';
    const parts = splitProtocolParts(cleanText);
    if (!parts.length) return;

    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];
      if (i === 0 && toolPrefix) part = toolPrefix + part;

      const useFallback = replyFallbackOnAllParts || i === 0;
      const { replyId, segments } = resolveOutgoingMessage(part, {
        fallbackReplyId: useFallback ? fallbackReplyId : null
      });
      const payload = buildOutboundSegments({ replyId, segments });
      if (!payload.length) continue;

      await e.reply(payload);

      if (i < parts.length - 1) {
        await BotUtil.sleep(randomRange(800, 1500));
      }
    }
  }

  cleanupCache() {
    for (const [historyKey, messages] of ChatStream.messageHistory.entries()) {
      if (!messages || messages.length === 0) {
        ChatStream.messageHistory.delete(historyKey);
        continue;
      }
      if (messages.length > 50) ChatStream.messageHistory.set(historyKey, messages.slice(-50));
    }
  }

  /**
   * 清除指定会话的 chat 历史（对齐 XRK-Yunzai ChatStream.clearConversation）
   * @param {string} scopeId - getEventHistoryKey 或 group/user id
   */
  static async clearConversation(scopeId, { e: _e = null } = {}) {
    const key = String(scopeId);
    const result = { success: true, cleared: { history: false, memory: false } };
    try {
      if (ChatStream.messageHistory.has(key)) {
        ChatStream.messageHistory.delete(key);
        result.cleared.history = true;
      }
      BotUtil.makeLog('debug', `[ChatStream] clearConversation scope=${key}`, 'ChatStream');
    } catch (error) {
      result.success = false;
      BotUtil.makeLog('error', `[ChatStream] clearConversation: ${error.message}`, 'ChatStream');
    }
    return result;
  }

  async cleanup() {
    await super.cleanup();
    
    if (ChatStream.cleanupTimer) {
      clearInterval(ChatStream.cleanupTimer);
      ChatStream.cleanupTimer = null;
    }
  }
}