import cfg from '#infrastructure/config/config.js'

export class OneBotBlacklistExample extends plugin {
  constructor() {
    super({
      name: 'OneBot黑白名单示例',
      dsc: '演示如何使用accept方法实现OneBot特定逻辑',
      event: 'onebot.*',
      priority: 5000,
      rule: []
    })
  }

  async accept(e) {
    const adapterName = String(e.adapter || e.adapter_name || '').toLowerCase()
    const isOneBot =
      adapterName.includes('onebot') ||
      (e.isOneBot && !['stdin', 'api', 'device'].includes(adapterName))

    if (!isOneBot) return true

    const other = cfg.getOther()
    const check = id => [Number(id), String(id)]

    const blackQQ = other.blackQQ || []
    if (blackQQ.length > 0) {
      if (check(e.user_id).some(id => blackQQ.includes(id))) return false
      if (e.at && check(e.at).some(id => blackQQ.includes(id))) return false
    }

    const blackDevice = other.blackDevice || []
    if (e.device_id && blackDevice.includes(e.device_id)) return false

    const whiteQQ = other.whiteQQ || []
    if (whiteQQ.length > 0 && !check(e.user_id).some(id => whiteQQ.includes(id))) return false

    if (e.group_id) {
      const blackGroup = other.blackGroup || []
      if (check(e.group_id).some(id => blackGroup.includes(id))) return false

      const whiteGroup = other.whiteGroup || []
      if (whiteGroup.length > 0 && !check(e.group_id).some(id => whiteGroup.includes(id))) return false
    }

    if (other.disableGuildMsg === true && e.detail_type === 'guild') return false

    return true
  }
}

