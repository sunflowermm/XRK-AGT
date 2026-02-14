const RESTART_KEY = 'AGT:restart'
const SHUTDOWN_KEY = 'AGT:shutdown'

export class Restart extends plugin {
  constructor(e = '') {
    super({
      name: '重启与关机',
      dsc: '#重启 #关机 #停机 #开机',
      event: 'message',
      priority: 10,
      rule: [
        { reg: '^#重启$', fnc: 'restart', permission: 'master' },
        { reg: '^#(停机|关机)$', fnc: 'stop', permission: 'master' },
        { reg: '^#开机$', fnc: 'start', permission: 'master' },
      ],
    })
    e && (this.e = e)
  }

  async init() {
    if (Restart._ackDone) return
    Restart._ackDone = true
    Bot.on('device.online', (d) => d?.device_id && Restart._sendRestartAck(d.device_id))
    Bot.on('ready', (d) => (d?.self_id ?? d?.uin) && Restart._sendRestartAck(d.self_id ?? d.uin))
    setTimeout(() => (Bot.uin || []).forEach((uin) => Restart._sendRestartAck(uin)), 5000)
    logger.mark('[重启] 已注册重连/就绪回复耗时')
  }

  static async _sendRestartAck(uid) {
    if (!uid || !redis?.get) return
    const key = `${RESTART_KEY}:${uid}`
    try {
      const raw = await redis.get(key)
      if (!raw) return
      const d = JSON.parse(raw)
      await redis.del(key)
      const msg = `重启完成，耗时 ${((Date.now() - (d.time || 0)) / 1000).toFixed(1)} 秒`
      const bot = Bot[uid]
      let sent = false
      if (bot?.reply) {
        sent = await bot.reply(msg).then(() => true).catch(() => false)
      } else if (bot?.sendMsg && (d.tasker === 'device' || !d.id)) {
        sent = await bot.sendMsg(msg).then(() => true).catch(() => false)
      } else if (d.tasker === 'onebot' && d.id && (d.isGroup ? Bot.sendGroupMsg : Bot.sendFriendMsg)) {
        if (d.isGroup) await Bot.sendGroupMsg(d.uin, d.id, msg)
        else await Bot.sendFriendMsg(d.uin, d.id, msg)
        sent = true
      }
      if (sent) logger.mark(`[重启] 已向 ${uid} 回复耗时`)
    } catch (err) {
      logger.error(`[重启] 回复耗时失败 ${uid}: ${err.message}`, err)
    }
  }

  _uin() {
    return this.e?.self_id || this.e?.bot?.uin || Bot.uin?.[0]
  }

  async restart() {
    const uin = this._uin()
    await this.e.reply('开始执行重启，请稍等...')
    await redis.set(`${RESTART_KEY}:${uin}`, JSON.stringify({
      uin,
      tasker: this.e.tasker || (this.e.device_id ? 'device' : 'onebot'),
      isGroup: !!this.e.isGroup,
      id: this.e.isGroup ? this.e.group_id : this.e.user_id,
      time: Date.now(),
      user_id: this.e.user_id,
    }), { EX: 300 })
    logger.mark(`[重启] 保存重启信息到 ${RESTART_KEY}:${uin}`)
    setTimeout(() => process.exit(1), 1000)
    return true
  }

  async stop() {
    const uin = this._uin()
    await redis.set(`${SHUTDOWN_KEY}:${uin}`, 'true')
    await this.e.reply('关机成功，已停止运行。发送"#开机"可恢复运行')
    logger.mark(`[关机][${uin}] 机器人已关机`)
    return true
  }

  async start() {
    const uin = this._uin()
    if ((await redis.get(`${SHUTDOWN_KEY}:${uin}`)) !== 'true') {
      await this.e.reply('机器人已经处于开机状态')
      return false
    }
    await redis.del(`${SHUTDOWN_KEY}:${uin}`)
    await this.e.reply('开机成功，恢复正常运行')
    logger.mark(`[开机][${uin}] 机器人已开机`)
    return true
  }
}