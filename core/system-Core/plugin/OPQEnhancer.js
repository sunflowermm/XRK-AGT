import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

/**
 * OPQBot事件增强插件
 * 为OPQBot事件补齐属性并标准化
 */
export default class OPQEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'OPQBot',
      dsc: 'OPQBot 事件增强与日志统一',
      event: 'opqbot.*',
      tasker: 'opqbot',
      priority: 100
    })
  }

  /**
   * 检查是否是目标事件
   * @param {Object} e - 事件对象
   * @param {string} taskerName - tasker名称
   * @returns {boolean}
   */
  isTargetEvent(e, taskerName) {
    return taskerName.includes('opq') || e.isOpqbot
  }

  /**
   * 增强事件属性
   * @param {Object} e - 事件对象
   */
  enhanceEvent(e) {
    super.enhanceEvent(e) // 设置 isOpqbot, tasker 和 logText
    this.bindBotEntities(e) // 使用基类提供的 bindBotEntities 方法
  }
}