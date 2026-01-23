import cfg from '#infrastructure/config/config.js'
import BotUtil from '#utils/botutil.js'
import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

export default class OneBotEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'OneBot',
      dsc: '为OneBot事件挂载特定属性',
      event: 'onebot.*',
      tasker: 'onebot',
      priority: 100 // 设置较高优先级，确保先执行
    })
  }

  isTargetEvent(e, taskerName) {
    return taskerName.includes('onebot') && !['stdin', 'api', 'device'].includes(taskerName)
  }

  enhanceEvent(e) {
    super.enhanceEvent(e) // 设置 isOnebot, tasker 和 logText

    // 设置消息类型标识（EventNormalizer已处理message_type，这里补充标识）
    e.isPrivate = e.message_type === 'private' || (!e.group_id && e.user_id)
    e.isGroup = e.message_type === 'group' || !!e.group_id

    // 绑定机器人实体
    this.bindBotEntities(e)

    // 处理@消息
    this.processAtProperties(e)

    // 补充sender信息（EventNormalizer已处理基础字段，这里补充OneBot特有字段）
    if (e.user_id && e.sender) {
      // 优先使用friend的nickname
      if (e.friend?.nickname && !e.sender.nickname) {
        e.sender.nickname = e.friend.nickname
      }
      
      // 群成员信息优先于friend
      if (e.member) {
        if (e.member.nickname && !e.sender.nickname) {
          e.sender.nickname = e.member.nickname
        }
        if (e.member.card && !e.sender.card) {
          e.sender.card = e.member.card
        }
      }
    }
  }

  setupReply(e) {
    if (e.reply) return // 如果已经设置过reply，则跳过

    let sendMethod = null
    
    // 优先使用群组发送方法
    if (e.isGroup && e.group_id) {
      if (e.group?.sendMsg) {
        sendMethod = e.group.sendMsg.bind(e.group)
      } else if (e.bot?.tasker?.sendGroupMsg) {
        sendMethod = (msg) => e.bot.tasker.sendGroupMsg({ ...e, group_id: e.group_id }, msg)
      }
    }
    
    // 私聊发送方法
    if (!sendMethod && e.isPrivate && e.user_id) {
      if (e.friend?.sendMsg) {
        sendMethod = e.friend.sendMsg.bind(e.friend)
      } else if (e.bot?.tasker?.sendFriendMsg) {
        sendMethod = (msg) => e.bot.tasker.sendFriendMsg({ ...e, user_id: e.user_id }, msg)
      }
    }

    if (!sendMethod) return

    e.reply = async (msg = '', quote = false, data = {}) => {
      if (!msg) return false

      try {
        let message = msg

        // 处理引用回复
        if (quote && e.message_id) {
          const replySegment = { type: 'reply', data: { id: String(e.message_id) } }
          message = Array.isArray(message) ? [replySegment, ...message] : [replySegment, message]
        }

        // 处理@消息
        if (data?.at && e.isGroup && e.user_id) {
          const atSegment = { type: 'at', data: { qq: String(e.user_id) } }
          message = Array.isArray(message) ? [atSegment, ...message] : [atSegment, message]
        }

        return await sendMethod(message)
      } catch (error) {
        BotUtil.makeLog('error', `回复消息失败: ${error.message}`, e.self_id)
        return false
      }
    }
  }

  processAtProperties(e) {
    if (!e.message || !Array.isArray(e.message)) return

    const atList = []
    let atBot = false
    const selfId = e.self_id || e.bot?.self_id

    for (const seg of e.message) {
      if (seg.type === 'at') {
        const qq = seg.qq || seg.user_id
        if (qq) {
          atList.push(String(qq))
          if (selfId && (String(qq) === String(selfId) || qq === 'all')) {
            atBot = true
          }
        }
      }
    }

    if (atList.length > 0) {
      e.atList = atList
      e.at = atList[0]
    }

    if (atBot) {
      e.atBot = true
    }
  }

  applyAlias(e) {
    if (!e.group_id || !e.msg) return
    const groupCfg = cfg.getGroup(e.group_id) || {}
    const aliases = this.normalizeAliasList(groupCfg.botAlias)
    if (!aliases.length) return

    for (const alias of aliases) {
      if (alias && e.msg.startsWith(alias)) {
        e.msg = e.msg.slice(alias.length).trim()
        e.hasAlias = true
        break
      }
    }
  }

  applyConfigPolicies(e) {
    try {
      const chatbotCfg = cfg.chatbot || {}
      const {
        blacklist = {},
        whitelist = {},
        privateChat = {},
        guild = {}
      } = chatbotCfg
      
      const blackQQ = blacklist?.qq || []
      const whiteQQ = whitelist?.qq || []
      const blackGroup = blacklist?.groups || []
      const whiteGroup = whitelist?.groups || []
      const disablePrivate = privateChat?.enabled === false
      const disableMsg = privateChat?.disableMsg || '私聊功能已禁用'
      const disableAdopt = privateChat?.disableAdopt || []
      const disableGuildMsg = guild?.disableMsg === true

      // 统一字符串转换和比较
      const toStr = (v) => (v === undefined || v === null ? '' : String(v))
      const inList = (list, id) =>
        Array.isArray(list) && list.length > 0 && id && list.map(toStr).includes(toStr(id))

      const groupId = toStr(e.group_id || '')
      const userId = toStr(e.user_id || '')

      // 检查频道消息（guild）
      if (disableGuildMsg && groupId && groupId.includes('-') && !e.isMaster) {
        return 'return'
      }
      
      // 检查群组黑白名单
      if (groupId) {
        if (inList(blackGroup, groupId) && !e.isMaster) {
          return 'return'
        }
        if (Array.isArray(whiteGroup) && whiteGroup.length > 0 && !inList(whiteGroup, groupId) && !e.isMaster) {
          return 'return'
        }
      }
      
      // 检查用户黑白名单
      if (userId) {
        if (inList(blackQQ, userId) && !e.isMaster) {
          return 'return'
        }
        if (Array.isArray(whiteQQ) && whiteQQ.length > 0 && !inList(whiteQQ, userId) && !e.isMaster) {
          return 'return'
        }
      }
      
      // 检查私聊功能
      if (disablePrivate && e.isPrivate && !e.isMaster) {
        const text = String(e.msg || e.plainText || e.raw_message || '')
        const adopted = Array.isArray(disableAdopt) &&
          disableAdopt.filter(Boolean).some((key) => text.includes(String(key)))

        if (!adopted) {
          try {
            if (typeof e.reply === 'function') {
              await e.reply(disableMsg)
            }
          } catch (err) {
            // 静默失败
          }
          return 'return'
        }
      }

      return true
    } catch (error) {
      BotUtil.makeLog('error', `OneBotEnhancer 配置策略应用失败: ${error.message}`, e.self_id)
      return true
    }
  }

  enforceReplyPolicy(e) {
    // 非群组、设备、stdin事件跳过
    if (!e.group_id || e.isDevice || e.isStdin) return true

    const groupCfg = cfg.getGroup(e.group_id) || {}
    const onlyReplyAt = groupCfg.onlyReplyAt ?? 0

    // 未启用或未配置别名，允许回复
    if (onlyReplyAt === 0 || !groupCfg.botAlias) return true
    
    // 主人权限或已使用别名或@了机器人，允许回复
    if (onlyReplyAt === 2 && e.isMaster) return true
    if (e.hasAlias) return true
    if (e.atBot === true) return true

    // 其他情况跳过
    return 'return'
  }

  /**
   * 标准化别名列表
   * @param {string|Array} alias - 别名或别名数组
   * @returns {Array} 标准化后的别名数组
   */
  normalizeAliasList(alias) {
    if (!alias) return []
    return Array.isArray(alias) ? alias.filter(Boolean) : [alias].filter(Boolean)
  }
}