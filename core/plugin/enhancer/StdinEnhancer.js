export default class StdinEnhancer extends plugin {
  constructor() {
    super({
      name: 'stdin-enhancer',
      dsc: 'STDIN/API 事件统一补齐',
      event: 'stdin.*',
      priority: 1,
      rule: []
    })
  }

  async accept(e) {
    if (!this.isStdinEvent(e)) return true

    e.isStdin = true
    e.tasker = 'stdin'

    this.ensureSender(e)
    this.ensureLogText(e)
    return true
  }

  isStdinEvent(e) {
    const taskerName = String(e.tasker || e.tasker_name || '').toLowerCase()
    return taskerName === 'stdin' || taskerName === 'api' || e.source === 'api'
  }

  ensureSender(e) {
    if (!e.sender) e.sender = {}
    if (!e.user_id) e.user_id = e.sender.user_id || 'stdin'
    if (!e.sender.user_id) e.sender.user_id = e.user_id
    e.sender.nickname ||= e.sender.card || 'STDIN'
    e.sender.card ||= e.sender.nickname
  }

  ensureLogText(e) {
    if (e.logText && !/未知/.test(e.logText)) return
    e.logText = `[STDIN][${e.user_id || '未知'}]`
  }
}
