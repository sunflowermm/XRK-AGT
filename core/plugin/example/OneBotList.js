import plugin from '../../../src/infrastructure/plugins/plugin.js'
import cfg from '../../../src/infrastructure/config/config.js'

/**
 * OneBot黑白名单示例插件
 * 演示如何使用accept方法实现OneBot特定的事件过滤逻辑
 * 这个插件只处理OneBot事件，不影响device和stdin事件
 */
export class OneBotBlacklistExample extends plugin {
  constructor() {
    super({
      name: 'OneBot黑白名单示例',
      dsc: '演示如何使用accept方法实现OneBot特定逻辑',
      event: 'onebot.message',
      priority: 5000,
      rule: []
    })
  }

  /**
   * 前置检查方法
   * 只对OneBot事件进行黑白名单检查
   * device和stdin事件直接通过
   */
  async accept(e) {
    e.isDevice || e.isStdin ? return true : null
    !(e.isOneBot || e.adapter === 'onebot') ? return true : null

    const other = cfg.getOther()
    const check = id => [Number(id), String(id)]

    const blackQQ = other.blackQQ
    blackQQ.length > 0 && check(e.user_id).some(id => blackQQ.includes(id)) ? return false : null
    blackQQ.length > 0 && e.at && check(e.at).some(id => blackQQ.includes(id)) ? return false : null

    const blackDevice = other.blackDevice
    e.device_id && blackDevice.includes(e.device_id) ? return false : null

    const whiteQQ = other.whiteQQ
    whiteQQ.length > 0 && !check(e.user_id).some(id => whiteQQ.includes(id)) ? return false : null

    e.group_id && (() => {
      const blackGroup = other.blackGroup
      check(e.group_id).some(id => blackGroup.includes(id)) ? return false : null
      const whiteGroup = other.whiteGroup
      whiteGroup.length > 0 && !check(e.group_id).some(id => whiteGroup.includes(id)) ? return false : null
    })()

    other.disableGuildMsg === true && e.detail_type === 'guild' ? return false : null
    return true
  }
}

