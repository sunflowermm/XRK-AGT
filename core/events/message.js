import EventListener from '../../lib/listener/listener.js'

/**
 * 监听消息 事件
 * @class
 */
export default class messageEvent extends EventListener {
  constructor () {
    super({ event: 'message' })
  }

  async execute (e) {
    await this.plugins.deal(e);
  }
}