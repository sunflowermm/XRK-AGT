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
      event: 'onebot.message', // 只监听OneBot消息事件
      priority: 5000,
      rule: [
        {
          reg: '^#测试黑白名单$',
          fnc: 'testBlacklist'
        }
      ]
    })
  }

  /**
   * 前置检查方法
   * 只对OneBot事件进行黑白名单检查
   * device和stdin事件直接通过
   */
  async accept(e) {
    // 特殊事件（device、stdin）直接通过，不进行OneBot特定检查
    if (e.isDevice || e.isStdin) return true

    // 只对OneBot事件进行黑白名单检查
    if (e.isOneBot || e.adapter === 'onebot') {
      const other = cfg.getOther()
      if (!other) return true

      const check = id => [Number(id), String(id)]

      // 检查QQ黑名单
      const blackQQ = other.blackQQ || []
      if (Array.isArray(blackQQ) && blackQQ.length > 0) {
        if (check(e.user_id).some(id => blackQQ.includes(id))) {
          logger.debug(`[OneBot黑白名单] 用户 ${e.user_id} 在黑名单中，拒绝处理`)
          return false
        }
        if (e.at && check(e.at).some(id => blackQQ.includes(id))) {
          logger.debug(`[OneBot黑白名单] @的用户 ${e.at} 在黑名单中，拒绝处理`)
          return false
        }
      }

      // 检查设备黑名单
      const blackDevice = other.blackDevice || []
      if (e.device_id && Array.isArray(blackDevice) && blackDevice.includes(e.device_id)) {
        logger.debug(`[OneBot黑白名单] 设备 ${e.device_id} 在黑名单中，拒绝处理`)
        return false
      }

      // 检查QQ白名单
      const whiteQQ = other.whiteQQ || []
      if (Array.isArray(whiteQQ) && whiteQQ.length > 0) {
        if (!check(e.user_id).some(id => whiteQQ.includes(id))) {
          logger.debug(`[OneBot黑白名单] 用户 ${e.user_id} 不在白名单中，拒绝处理`)
          return false
        }
      }

      // 检查群组黑白名单
      if (e.group_id) {
        const blackGroup = other.blackGroup || []
        if (Array.isArray(blackGroup) && check(e.group_id).some(id => blackGroup.includes(id))) {
          logger.debug(`[OneBot黑白名单] 群组 ${e.group_id} 在黑名单中，拒绝处理`)
          return false
        }

        const whiteGroup = other.whiteGroup || []
        if (Array.isArray(whiteGroup) && whiteGroup.length > 0) {
          if (!check(e.group_id).some(id => whiteGroup.includes(id))) {
            logger.debug(`[OneBot黑白名单] 群组 ${e.group_id} 不在白名单中，拒绝处理`)
            return false
          }
        }
      }

      // 检查频道消息（如果禁用）
      if (other.disableGuildMsg === true && e.detail_type === 'guild') {
        logger.debug(`[OneBot黑白名单] 频道消息已禁用，拒绝处理`)
        return false
      }
    }

    return true
  }

  /**
   * 测试方法
   */
  async testBlacklist(e) {
    logger.info(`[OneBot黑白名单示例] 收到测试消息: ${e.msg} 来自: ${e.sender.nickname}(${e.user_id})`)
    await e.reply(`OneBot黑白名单检查通过！\n用户ID: ${e.user_id}\n适配器: ${e.adapter}`)
    return true
  }
}

