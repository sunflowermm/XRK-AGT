export default class OPQEnhancer extends plugin {
  constructor() {
    super({
      name: 'opq-enhancer',
      dsc: 'OPQBot 事件增强与日志统一',
      event: 'opqbot.*',
      priority: 5,
      rule: []
    })

    this.adapters = ['opq', 'opqbot']
  }

  async accept(e) {
    if (!this.isOPQ(e)) return true

    e.isOPQ = true
    e.adapter = 'opqbot'

    this.bindBotEntities(e)
    this.ensureLogText(e)
    return true
  }

  isOPQ(e) {
    const adapterName = String(e.adapter || e.adapter_name || '').toLowerCase()
    return this.adapters.some(name => adapterName.includes(name))
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

    if (e.group_id && e.bot.pickGroup) {
      safeDefine('group', () => e.bot.pickGroup(e.group_id))
    }
  }

  ensureLogText(e) {
    if (e.logText && !/未知/.test(e.logText)) return
    const scope = e.group_id ? `group:${e.group_id}` : (e.user_id || 'unknown')
    e.logText = `[OPQBot][${scope}]`
  }
}


