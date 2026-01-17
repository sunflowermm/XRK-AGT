import cfg from '#infrastructure/config/config.js'
import BotUtil from '#utils/botutil.js'
import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

export default class OneBotEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'OneBot事件增强',
      dsc: '为OneBot事件挂载特定属性',
      event: 'onebot.*'
    })
  }

  isTargetEvent(e, taskerName) {
    if (taskerName.includes('onebot')) return true
    if (e.isOneBot && !['stdin', 'api', 'device'].includes(taskerName)) return true
    return false
  }

  isOneBotEvent(taskerName, e) {
    if (taskerName.includes('onebot')) return true
    if (e.isOneBot && !['stdin', 'api', 'device'].includes(taskerName)) return true
    return false
  }

  enhanceEvent(e) {
    if (!e.bot) return

    e.isPrivate = e.message_type === 'private' || (!e.group_id && e.user_id)
    e.isGroup = e.message_type === 'group' || !!e.group_id

    if (e.user_id && !e.friend && e.bot.pickFriend) {
      try {
        Object.defineProperty(e, "friend", {
          get() { return e.bot.pickFriend(e.user_id) },
          configurable: true,
          enumerable: false
        })
      } catch (error) {
        // 静默失败
      }
    }

    if (e.group_id && !e.group && e.bot.pickGroup) {
      try {
        Object.defineProperty(e, "group", {
          get() { return e.bot.pickGroup(e.group_id) },
          configurable: true,
          enumerable: false
        })
        
        if (!e.group_name && e.group?.name) {
          e.group_name = e.group.name
        } else if (!e.group_name && e.group?.group_name) {
          e.group_name = e.group.group_name
        }
      } catch (error) {
        // 静默失败
      }
    }

    if (e.group_id && e.user_id && !e.member && e.bot.pickMember) {
      try {
        Object.defineProperty(e, "member", {
          get() { return e.bot.pickMember(e.group_id, e.user_id) },
          configurable: true,
          enumerable: false
        })
      } catch (error) {
        // 静默失败
      }
    }

    this.processAtProperties(e)

    if (e.user_id) {
      if (!e.sender) e.sender = { user_id: e.user_id }
      
      if (e.friend?.nickname && !e.sender.nickname) {
        e.sender.nickname = e.friend.nickname
      }
      
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
    let sendMethod = null
    if (e.group?.sendMsg) {
      sendMethod = e.group.sendMsg.bind(e.group)
    } else if (e.bot?.tasker?.sendGroupMsg && e.group_id) {
      sendMethod = (msg) => e.bot.tasker.sendGroupMsg({ ...e, group_id: e.group_id }, msg)
    } else if (e.friend?.sendMsg) {
      sendMethod = e.friend.sendMsg.bind(e.friend)
    } else if (e.bot?.tasker?.sendFriendMsg && e.user_id) {
      sendMethod = (msg) => e.bot.tasker.sendFriendMsg({ ...e, user_id: e.user_id }, msg)
    }

    if (!sendMethod) return

    e.reply = async (msg = '', quote = false, data = {}) => {
      if (!msg) return false

      try {
        let message = msg

        if (quote && e.message_id) {
          const replySegment = { type: 'reply', data: { id: String(e.message_id) } }
          message = Array.isArray(message) ? [replySegment, ...message] : [replySegment, message]
        }

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
      const otherCfg = cfg.getOther() || {}
      const {
        blackQQ = [],
        whiteQQ = [],
        blackGroup = [],
        whiteGroup = [],
        disablePrivate = false,
        disableMsg = '私聊功能已禁用',
        disableAdopt = [],
        disableGuildMsg = false
      } = otherCfg

      const toStr = (v) => (v === undefined || v === null ? '' : String(v))
      const inList = (list, id) =>
        Array.isArray(list) && list.length > 0 && id && list.map(toStr).includes(toStr(id))

      const groupId = toStr(e.group_id || '')
      const userId = toStr(e.user_id || '')

      if (disableGuildMsg && groupId && groupId.includes('-') && !e.isMaster) {
        return 'return'
      }
      
      if (groupId) {
        if (inList(blackGroup, groupId) && !e.isMaster) {
          return 'return'
        }
        if (Array.isArray(whiteGroup) && whiteGroup.length > 0 && !inList(whiteGroup, groupId) && !e.isMaster) {
          return 'return'
        }
      }
      
      if (userId) {
        if (inList(blackQQ, userId) && !e.isMaster) {
          return 'return'
        }
        if (Array.isArray(whiteQQ) && whiteQQ.length > 0 && !inList(whiteQQ, userId) && !e.isMaster) {
          return 'return'
        }
      }
      
      const isPrivate =
        e.isPrivate ||
        (!e.group_id && (e.message_type === 'private' || (!e.message_type && !e.group_id)))

      if (disablePrivate && isPrivate && !e.isMaster) {
        const text = String(e.msg || e.plainText || e.raw_message || '')
        const adopted =
          Array.isArray(disableAdopt) &&
          disableAdopt.filter(Boolean).some((key) => text.includes(String(key)))

        if (!adopted) {
          try {
            if (typeof e.reply === 'function') {
              e.reply(disableMsg || '私聊功能已禁用')
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
    if (!e.group_id || e.isDevice || e.isStdin) return true

    const groupCfg = cfg.getGroup(e.group_id) || {}
    const onlyReplyAt = groupCfg.onlyReplyAt ?? 0

    if (onlyReplyAt === 0 || !groupCfg.botAlias) return true
    if (onlyReplyAt === 2 && e.isMaster) return true
    if (e.hasAlias) return true
    if (e.atBot === true) return true

    return 'return'
  }

  normalizeAliasList(alias) {
    if (!alias) return []
    return Array.isArray(alias) ? alias.filter(Boolean) : [alias].filter(Boolean)
  }
}
