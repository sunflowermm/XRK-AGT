import cfg from '#infrastructure/config/config.js';
import { segment } from '#oicq';
import BotUtil from '#utils/botutil.js';

/**
 * 消息处理器
 * 负责解析和处理传入的消息事件。
 */
class MessageHandler {
  /**
   * 处理消息内容
   * @param {Object} e - 事件对象
   */
  async dealMsg(e) {
    try {
      this.initMsgProps(e);
      await this.parseMessage(e);
      this.setupEventProps(e);
      this.checkPermissions(e);

      if (e.msg && e.isGroup && !e.isDevice && !e.isStdin) {
        this.processAlias(e);
      }

    } catch (error) {
      logger.error('处理消息内容错误', error);
    }
  }

  /**
   * 初始化消息属性
   * @param {Object} e - 事件对象
   */
  initMsgProps(e) {
    e.img = [];
    e.video = [];
    e.audio = [];
    e.msg = '';
    e.atList = [];
    e.atBot = false;
    e.message = Array.isArray(e.message) ? e.message :
      (e.message ? [{ type: 'text', text: String(e.message) }] : []);
  }

  /**
   * 解析消息内容
   * @param {Object} e - 事件对象
   */
  async parseMessage(e) {
    for (const val of e.message) {
      if (!val?.type) continue;

      switch (val.type) {
        case 'text':
          e.msg += this.dealText(val.text || '');
          break;
        case 'image':
          if (val.url || val.file) e.img.push(val.url || val.file);
          break;
        case 'video':
          if (val.url || val.file) e.video.push(val.url || val.file);
          break;
        case 'audio':
          if (val.url || val.file) e.audio.push(val.url || val.file);
          break;
        case 'at':
          const id = val.qq || val.id;
          if (id == e.bot?.uin || id == e.bot?.tiny_id) {
            e.atBot = true;
          } else if (id) {
            e.at = id;
            e.atList.push(id);
          }
          break;
        case 'reply':
          e.source = {
            message_id: val.id,
            seq: val.data?.seq,
            time: val.data?.time,
            user_id: val.data?.user_id,
            raw_message: val.data?.message,
          };
          e.reply_id = val.id;
          break;
        case 'file':
          e.file = {
            name: val.name,
            fid: val.fid,
            size: val.size,
            url: val.url
          };
          if (!e.fileList) e.fileList = [];
          e.fileList.push(e.file);
          break;
        case 'face':
          if (!e.face) e.face = [];
          if (val.id !== undefined) e.face.push(val.id);
          break;
      }
    }
  }

  /**
   * 设置事件属性
   * @param {Object} e - 事件对象
   */
  setupEventProps(e) {
    e.isPrivate = e.message_type === 'private' || e.notice_type === 'friend';
    e.isGroup = e.message_type === 'group' || e.notice_type === 'group';
    e.isGuild = e.detail_type === 'guild';

    if (!e.sender) {
      e.sender = e.member || e.friend || {};
    }
    e.sender.card ||= e.sender.nickname || e.device_name || '';
    e.sender.nickname ||= e.sender.card;

    if (e.isDevice) {
      e.logText = `[设备][${e.device_name || e.device_id}][${e.event_type || '事件'}]`;
    } else if (e.isStdin) {
      e.logText = `[${e.adapter === 'api' ? 'API' : 'STDIN'}][${e.user_id || '未知'}]`;
    } else if (e.isPrivate) {
      e.logText = `[私聊][${e.sender.card}(${e.user_id})]`;
    } else if (e.isGroup) {
      e.logText = `[${e.group_name || e.group_id}(${e.group_id})][${e.sender.card}(${e.user_id})]`;
    }

    e.getReply = async () => {
      const msgId = e.source?.message_id || e.reply_id;
      if (!msgId) return null;
      try {
        const target = e.isGroup ? e.group : e.friend;
        return target?.getMsg ? await target.getMsg(msgId) : null;
      } catch (error) {
        logger.debug(`获取回复消息失败: ${error.message}`);
        return null;
      }
    };

    if (!e.recall && e.message_id && !e.isDevice && !e.isStdin) {
      const target = e.isGroup ? e.group : e.friend;
      if (target?.recallMsg) {
        e.recall = () => target.recallMsg(e.message_id);
      }
    }
  }

  /**
   * 检查权限
   * @param {Object} e - 事件对象
   */
  checkPermissions(e) {
    const masterQQ = cfg.masterQQ || cfg.master?.[e.self_id] || [];
    const masters = Array.isArray(masterQQ) ? masterQQ : [masterQQ];

    if (masters.some(id => String(e.user_id) === String(id))) {
      e.isMaster = true;
    }

    if (e.isStdin && e.isMaster === undefined) {
      e.isMaster = true;
    }
  }

  /**
   * 处理群聊别名
   * @param {Object} e - 事件对象
   */
  processAlias(e) {
    const groupCfg = cfg.getGroup(e.group_id);
    const alias = groupCfg?.botAlias;
    if (!alias) return;

    const aliases = Array.isArray(alias) ? alias : [alias];
    for (const a of aliases) {
      if (a && e.msg.startsWith(a)) {
        e.msg = e.msg.slice(a.length).trim();
        e.hasAlias = true;
        break;
      }
    }
  }

  /**
   * 处理文本规范化
   * @param {string} text - 文本内容
   * @returns {string}
   */
  dealText(text = '') {
    text = String(text ?? '');
    if (cfg.bot?.['/→#']) text = text.replace(/^\s*\/\s*/, '#');
    return text
      .replace(/^\s*[＃井#]+\s*/, '#')
      .replace(/^\s*[\\*※＊]+\s*/, '*')
      .trim();
  }
}

export default new MessageHandler();

