import cfg from '#infrastructure/config/config.js'

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

  async accept(e) {
    (e.isDevice || e.isStdin) && (() => true)()
    !(e.isOneBot || e.adapter === 'onebot') && (() => true)()

    const other = cfg.getOther()
    const check = id => [Number(id), String(id)]

    const blackQQ = other.blackQQ
    blackQQ.length > 0 && check(e.user_id).some(id => blackQQ.includes(id)) && (() => false)()
    blackQQ.length > 0 && e.at && check(e.at).some(id => blackQQ.includes(id)) && (() => false)()

    const blackDevice = other.blackDevice
    e.device_id && blackDevice.includes(e.device_id) && (() => false)()

    const whiteQQ = other.whiteQQ
    whiteQQ.length > 0 && !check(e.user_id).some(id => whiteQQ.includes(id)) && (() => false)()

    e.group_id && (() => {
      const blackGroup = other.blackGroup
      check(e.group_id).some(id => blackGroup.includes(id)) && (() => false)()
      const whiteGroup = other.whiteGroup
      whiteGroup.length > 0 && !check(e.group_id).some(id => whiteGroup.includes(id)) && (() => false)()
    })()

    other.disableGuildMsg === true && e.detail_type === 'guild' && (() => false)()
    return true
  }
}

