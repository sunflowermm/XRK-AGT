import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

export default class OPQEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'opq-enhancer',
      dsc: 'OPQBot 事件增强与日志统一',
      event: 'opqbot.*'
    })
  }

  isTargetEvent(e, taskerName) {
    return taskerName.includes('opqbot') || taskerName.includes('opq')
  }

  enhanceEvent(e) {
    e.isOPQ = true
    e.tasker = 'opqbot'

    this.bindBotEntities(e)
    const scope = e.group_id ? `group:${e.group_id}` : (e.user_id || 'unknown')
    this.ensureLogText(e, 'OPQBot', scope, '')
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
}
