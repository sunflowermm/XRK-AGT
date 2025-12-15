import plugin from '#infrastructure/plugins/plugin.js'
import BotUtil from '#utils/botutil.js'

/**
 * OneBot事件增强插件
 * 专门处理OneBot适配器特定的事件属性挂载
 * 使用accept方法，只对OneBot事件生效，不影响其他适配器（stdin、device等）
 * 
 * 此插件将原本在bot.js的prepareEvent中的OneBot特定逻辑移到这里，
 * 使底层代码更通用，适配器特定逻辑由插件处理
 */
export default class OneBotEnhancer extends plugin {
  constructor() {
    super({
      name: 'OneBot事件增强',
      dsc: '为OneBot事件挂载特定属性（friend、group、member、group_name、sender信息等）',
      event: 'onebot.*', // 监听所有OneBot事件
      priority: 1, // 最高优先级，确保最先执行
      rule: []
    })
  }

  /**
   * 接受事件并挂载OneBot特定属性
   * 只处理OneBot事件，其他适配器事件直接通过
   */
  async accept(e) {
    // 跳过非OneBot事件
    if (e.isDevice || e.isStdin) return true
    
    // 判断是否为OneBot事件
    const isOneBot = e.isOneBot || 
                     e.adapter === 'onebot' || 
                     e.adapter_name === 'OneBotv11' ||
                     (e.post_type && !e.isDevice && !e.isStdin && e.adapter !== 'device' && e.adapter !== 'stdin')
    
    if (!isOneBot) return true

    // 设置OneBot标识
    e.isOneBot = true
    if (!e.adapter) e.adapter = 'onebot'

    // 挂载OneBot特定的事件属性
    this.enhanceEvent(e)

    return true // 继续处理后续插件
  }

  /**
   * 增强事件属性（从bot.js的prepareEvent移出的逻辑）
   */
  enhanceEvent(e) {
    if (!e.bot) return

    // 设置OneBot特定的类型标识
    e.isPrivate = e.message_type === 'private' || (!e.group_id && e.user_id)
    e.isGroup = e.message_type === 'group' || !!e.group_id

    // 挂载friend对象（私聊/好友相关）
    if (e.user_id && !e.friend && e.bot.pickFriend) {
      try {
        Object.defineProperty(e, "friend", {
          get() {
            return e.bot.pickFriend(e.user_id)
          },
          configurable: true,
          enumerable: false
        })
      } catch (error) {
        BotUtil.makeLog('debug', `挂载friend失败: ${error.message}`, e.self_id)
      }
    }

    // 挂载group对象（群聊相关）
    if (e.group_id && !e.group && e.bot.pickGroup) {
      try {
        Object.defineProperty(e, "group", {
          get() {
            return e.bot.pickGroup(e.group_id)
          },
          configurable: true,
          enumerable: false
        })
        
        // 设置群名称（延迟获取）
        if (!e.group_name && e.group?.name) {
          e.group_name = e.group.name
        } else if (!e.group_name && e.group?.group_name) {
          e.group_name = e.group.group_name
        }
      } catch (error) {
        BotUtil.makeLog('debug', `挂载group失败: ${error.message}`, e.self_id)
      }
    }

    // 挂载member对象（群成员相关）
    if (e.group_id && e.user_id && !e.member && e.bot.pickMember) {
      try {
        Object.defineProperty(e, "member", {
          get() {
            return e.bot.pickMember(e.group_id, e.user_id)
          },
          configurable: true,
          enumerable: false
        })
      } catch (error) {
        BotUtil.makeLog('debug', `挂载member失败: ${error.message}`, e.self_id)
      }
    }

    // 处理@相关属性（OneBot特定）
    this.processAtProperties(e)

    // 增强sender信息（OneBot特定）
    if (e.user_id) {
      if (!e.sender) {
        e.sender = { user_id: e.user_id }
      }
      
      // 从friend获取昵称
      if (e.friend?.nickname && !e.sender.nickname) {
        e.sender.nickname = e.friend.nickname
      }
      
      // 从member获取昵称和群名片
      if (e.member) {
        if (e.member.nickname && !e.sender.nickname) {
          e.sender.nickname = e.member.nickname
        }
        if (e.member.card && !e.sender.card) {
          e.sender.card = e.member.card
        }
      }
    }

    // 设置reply方法（基于group或friend）
    if (!e.reply) {
      if (e.group?.sendMsg) {
        e.reply = e.group.sendMsg.bind(e.group)
      } else if (e.friend?.sendMsg) {
        e.reply = e.friend.sendMsg.bind(e.friend)
      }
    }
  }

  /**
   * 处理@相关属性（OneBot特定）
   */
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
      e.at = atList[0] // 兼容旧代码
    }

    if (atBot) {
      e.atBot = true
    }
  }

}

