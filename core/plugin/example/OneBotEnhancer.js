import plugin from '#infrastructure/plugins/plugin.js'
import BotUtil from '#utils/botutil.js'

export default class OneBotEnhancer extends plugin {
  constructor() {
    super({
      name: 'OneBot事件增强',
      dsc: '为OneBot事件挂载特定属性',
      event: 'onebot.*',
      priority: 1,
      rule: []
    })
  }

  async accept(e) {
    const adapterName = String(e.adapter || e.adapter_name || '').toLowerCase()
    const isOneBot =
      adapterName.includes('onebot') ||
      (e.isOneBot && !['stdin', 'api', 'device'].includes(adapterName))

    if (!isOneBot) return true

    e.isOneBot = true
    if (!adapterName.includes('onebot')) e.adapter = 'onebot'

    this.enhanceEvent(e)
    this.setupReply(e)

    return true
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
        BotUtil.makeLog('debug', `挂载friend失败: ${error.message}`, e.self_id)
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
        BotUtil.makeLog('debug', `挂载group失败: ${error.message}`, e.self_id)
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
        BotUtil.makeLog('debug', `挂载member失败: ${error.message}`, e.self_id)
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
    const replyMethod = e.group?.sendMsg ? e.group.sendMsg.bind(e.group) :
                       e.friend?.sendMsg ? e.friend.sendMsg.bind(e.friend) : null
    
    if (!replyMethod) return

    if (e._replySetup) {
      e.replyNew = replyMethod
    } else if (!e.reply) {
      e.reply = replyMethod
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
}

