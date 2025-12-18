export default class DeviceEnhancer extends plugin {
  constructor() {
    super({
      name: 'device-enhancer',
      dsc: '设备事件属性补齐与日志标准化',
      event: 'device.*',
      priority: 1,
      rule: []
    })
  }

  async accept(e) {
    if (!this.isDeviceEvent(e)) return true

    e.isDevice = true
    e.tasker = 'device'
    this.ensureLogText(e)
    return true
  }

  isDeviceEvent(e) {
    const taskerName = String(e.tasker || e.tasker_name || '').toLowerCase()
    return taskerName === 'device' || e.post_type === 'device' || e.isDevice
  }

  ensureLogText(e) {
    if (e.logText && !/未知/.test(e.logText)) return
    const deviceId = e.device_id || e.self_id || 'unknown'
    const eventType = e.event_type || e.post_type || 'event'
    e.logText = `[设备][${deviceId}][${eventType}]`
  }
}
