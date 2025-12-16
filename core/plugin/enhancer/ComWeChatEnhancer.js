export default class ComWeChatEnhancer extends plugin {
  constructor() {
    super({
      name: 'comwechat-enhancer',
      dsc: '为 ComWeChat 事件补齐平台属性与日志',
      event: 'comwechat.*',
      priority: 5,
      rule: []
    })
  }

  async accept(e) {
    if (!this.isComWeChat(e)) return true

    e.isComWeChat = true
    e.tasker = 'comwechat'
    e.platform = 'wechat'

    this.bindBotEntities(e)
    this.ensureLogText(e)
    return true
  }

  isComWeChat(e) {
    const taskerName = String(e.tasker || e.tasker_name || '').toLowerCase()
    return taskerName.includes('comwechat') || taskerName.includes('wechat')
  }

  bindBotEntities(e) {
    if (!e.bot) return

    const safeDefine = (key, getter) => {
      if (e[key]) return
      try {
        Object.defineProperty(e, key, {
          get: getter,
          configurable: true,
          enumerable: false
        })
      } catch {}
    }

    if (e.user_id && e.bot.pickFriend) {
      safeDefine('friend', () => e.bot.pickFriend(e.user_id))
    }

    const roomId = e.group_id || e.room_id
    if (roomId && e.bot.pickGroup) {
      safeDefine('group', () => e.bot.pickGroup(roomId))
    }
  }

  ensureLogText(e) {
    if (e.logText && !/未知/.test(e.logText)) return
    const scope = e.group_id || e.room_id ? (e.group_id || e.room_id) : (e.user_id || 'unknown')
    e.logText = `[ComWeChat][${scope}]`
  }
}


