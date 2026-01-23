import PluginsLoader from "#infrastructure/plugins/loader.js"

/**
 * 事件监听器基类
 * 提供事件监听和处理的统一接口，用于监听Bot系统事件并触发插件处理。
 */
export default class EventListener {
  constructor(data) {
    this.prefix = data.prefix || ""
    this.event = data.event
    this.once = data.once || false
    this.plugins = PluginsLoader
  }
  
  /**
   * 执行事件处理
   * @param {Object} e - 事件对象
   */
  async execute(e) {
    if (!e) return
    this.plugins.deal(e)
  }

  /**
   * 获取监听器信息
   * @returns {Object} 监听器描述信息
   */
  getInfo() {
    return {
      prefix: this.prefix,
      event: this.event,
      once: this.once
    }
  }

  /**
   * 获取描述符（别名方法）
   * @returns {Object} 监听器描述信息
   */
  getDescriptor() {
    return this.getInfo()
  }
}