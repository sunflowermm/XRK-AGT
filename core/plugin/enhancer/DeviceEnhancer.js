import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

export default class DeviceEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'device-enhancer',
      dsc: '设备事件属性补齐与日志标准化',
      event: 'device.*'
    })
  }

  isTargetEvent(e, taskerName) {
    return taskerName === 'device' || e.post_type === 'device' || e.isDevice
  }

  enhanceEvent(e) {
    e.isDevice = true
    e.tasker = 'device'
    const deviceId = e.device_id || e.self_id || 'unknown'
    const eventType = e.event_type || e.post_type || 'event'
    this.ensureLogText(e, '设备', deviceId, eventType)
  }
}
