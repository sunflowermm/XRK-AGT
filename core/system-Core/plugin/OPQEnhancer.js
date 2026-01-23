import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

export default class OPQEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'OPQBot',
      dsc: 'OPQBot 事件增强与日志统一',
      event: 'opqbot.*',
      tasker: 'opqbot'
    })
  }

  isTargetEvent(e, taskerName) {
    return taskerName.includes('opq')
  }

  enhanceEvent(e) {
    super.enhanceEvent(e) // 设置 isOpqbot, tasker 和 logText
    this.bindBotEntities(e) // 使用基类提供的 bindBotEntities 方法
  }
}