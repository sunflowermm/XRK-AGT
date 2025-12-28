import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

export default class StdinEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'stdin-enhancer',
      dsc: 'STDIN/API 事件统一补齐',
      event: 'stdin.*'
    })
  }

  isTargetEvent(e, taskerName) {
    return taskerName === 'stdin' || taskerName === 'api' || e.source === 'api'
  }

  enhanceEvent(e) {
    e.isStdin = true
    e.tasker = 'stdin'

    // 确保sender
    if (!e.sender) e.sender = {}
    if (!e.user_id) e.user_id = e.sender.user_id || 'stdin'
    if (!e.sender.user_id) e.sender.user_id = e.user_id
    e.sender.nickname ||= e.sender.card || 'STDIN'
    e.sender.card ||= e.sender.nickname

    // 确保日志文本
    this.ensureLogText(e, 'STDIN', e.user_id || '未知', '')
  }
}
