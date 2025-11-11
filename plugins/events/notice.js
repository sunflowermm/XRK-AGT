import EventListener from '../../lib/listener/listener.js'

/**
 * 监听群聊消息 （理论上属于各类适配器的消息事件）
 * 处理群聊消息
 */
export default class noticeEvent extends EventListener {
  constructor () {
    super({ event: 'notice' })
  }

  async execute (e) {
    this.plugins.deal(e)
  }
}
