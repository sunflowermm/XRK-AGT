import EnhancerBase from '#infrastructure/plugins/enhancer-base.js'

export default class DeviceEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'Device',
      dsc: '设备事件属性补齐与日志标准化',
      event: 'device.*',
      tasker: 'device'
    })
  }

  isTargetEvent(e, taskerName) {
    return taskerName === 'device' || e.post_type === 'device' || e.isDevice
  }

  enhanceEvent(e) {
    super.enhanceEvent(e) // 设置 isDevice, tasker 和 logText
  }
}