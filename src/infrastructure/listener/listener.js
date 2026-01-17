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
  
  async execute(e) {
    this.plugins.deal(e)
  }

  getInfo() {
    return {
      prefix: this.prefix,
      event: this.event,
      once: this.once
    };
  }

  getDescriptor() {
    return this.getInfo();
  }
}