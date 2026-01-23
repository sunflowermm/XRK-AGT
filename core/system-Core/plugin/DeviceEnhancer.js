import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'
import { EventNormalizer } from '#utils/event-normalizer.js'

/**
 * Device事件增强插件
 * 为设备事件补齐属性并标准化日志
 */
export default class DeviceEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'Device',
      dsc: '设备事件属性补齐与日志标准化',
      event: 'device.*',
      tasker: 'device',
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
    return taskerName === 'device' || e.post_type === 'device' || e.isDevice
  }

  /**
   * 增强事件属性
   * @param {Object} e - 事件对象
   */
  enhanceEvent(e) {
    super.enhanceEvent(e) // 设置 isDevice, tasker 和 logText
    
    // 使用 EventNormalizer 标准化设备事件
    EventNormalizer.normalizeDevice(e)
  }
}