import PluginsLoader from "#infrastructure/plugins/loader.js"

/**
 * 事件监听器基类
 * 
 * 提供事件监听和处理的统一接口。
 * 用于监听Bot系统事件（如消息、通知、请求等）并触发插件处理。
 * 
 * @abstract
 * @class EventListener
 * @example
 * // 创建自定义事件监听器
 * export default class MyListener extends EventListener {
 *   constructor() {
 *     super({
 *       prefix: 'my-prefix',
 *       event: 'message',
 *       once: false
 *     });
 *   }
 *   
 *   async execute(e) {
 *     // 处理事件
 *     this.plugins.deal(e);
 *   }
 * }
 */
export default class EventListener {
  /**
   * 事件监听器构造函数
   * 
   * @param {Object} data - 监听器配置
   * @param {string} data.prefix - 事件名称前缀（用于区分不同监听器）
   * @param {string|Array<string>} data.event - 监听的事件名称或事件数组
   *   - 字符串：单个事件，如 'message'、'notice'、'request'
   *   - 数组：多个事件，如 ['message', 'notice']
   * @param {boolean} data.once - 是否只监听一次（默认false，持续监听）
   */
  constructor(data) {
    this.prefix = data.prefix || ""
    this.event = data.event
    this.once = data.once || false
    this.plugins = PluginsLoader
  }
  
  /**
   * 默认执行方法
   * @param e 事件对象
   */
  async execute(e) {
    this.plugins.deal(e)
  }
}