import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'
import { EventNormalizer } from '#utils/event-normalizer.js'

/**
 * STDIN事件增强插件
 * 为STDIN/API事件补齐属性并标准化
 */
export default class StdinEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'STDIN',
      dsc: 'STDIN/API 事件统一补齐',
      event: 'stdin.*',
      tasker: 'stdin',
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
    return taskerName === 'stdin' || taskerName === 'api' || e.source === 'api' || e.isStdin
  }

  /**
   * 增强事件属性
   * @param {Object} e - 事件对象
   */
  enhanceEvent(e) {
    super.enhanceEvent(e) // 设置 isStdin, tasker 和 logText
    
    // 使用 EventNormalizer 标准化STDIN事件
    EventNormalizer.normalizeStdin(e)
  }
}
