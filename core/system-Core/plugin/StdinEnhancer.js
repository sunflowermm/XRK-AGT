import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

export default class StdinEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'STDIN',
      dsc: 'STDIN/API 事件统一补齐',
      event: 'stdin.*',
      tasker: 'stdin'
    })
  }

  isTargetEvent(e, taskerName) {
    return taskerName === 'stdin' || taskerName === 'api' || e.source === 'api'
  }

  enhanceEvent(e) {
    super.enhanceEvent(e)
    // EventNormalizer已处理user_id和sender.user_id同步，无需重复
  }
}
