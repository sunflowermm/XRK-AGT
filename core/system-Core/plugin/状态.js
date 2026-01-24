import os from 'os'
import moment from 'moment'
import * as si from 'systeminformation'
import cfg from '#infrastructure/config/config.js'

// 模块级配置
let showNetworkInfo = true
let showProcessInfo = true
let showDiskInfo = true

export class stattools extends plugin {
  constructor() {
    super({
      name: 'System Status',
      dsc: '系统状态监控',
      event: 'message',
      priority: 5000,
      rule: [{
        reg: '^#状态$',
        fnc: 'status'
      }]
    })
  }

  async init() {
    // 从cfg读取配置
    const agtCfg = cfg.agt || {}
    const statusCfg = agtCfg.status || {}
    showNetworkInfo = statusCfg.showNetwork !== false
    showProcessInfo = statusCfg.showProcess !== false
    showDiskInfo = statusCfg.showDisk !== false
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let index = 0
    let size = bytes
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024
      index++
    }
    return `${size.toFixed(2)}${units[index]}`
  }

  formatTime(seconds) {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    let result = []
    if (days > 0) result.push(`${days}天`)
    if (hours > 0) result.push(`${hours}小时`)
    if (minutes > 0) result.push(`${minutes}分钟`)
    if (secs > 0 && days === 0 && hours === 0) result.push(`${secs}秒`)
    
    return result.length ? result.join('') : '0秒'
  }

  async status(e) {
    try {
      const [
        cpu,
        currentLoad,
        mem,
        fsSize,
        osInfo,
        processes,
        time,
        networkInterfaces
      ] = await Promise.all([
        si.cpu(),
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.osInfo(),
        si.processes(),
        si.time(),
        si.networkInterfaces()
      ])

      const bot = (globalThis.Bot && (Bot[e.self_id] || Bot)) || {}
      const startTime = bot.stat?.start_time
      const runtimeSeconds = typeof startTime === 'number'
        ? Math.floor(Date.now() / 1000 - startTime)
        : (time.uptime || os.uptime())
      const botRuntime = this.formatTime(runtimeSeconds)
      
      const loader = (await import('#infrastructure/plugins/loader.js')).default
      const pluginCount = loader.priority.length + loader.extended.length
      const taskCount = loader.task.length

      // Node进程信息
      const nodeUsage = process.memoryUsage()
      const nodeVersion = process.version
      
      const mainDisk = fsSize.find(fs => fs.mount === '/' || fs.mount === 'C:\\') || 
                       fsSize.reduce((prev, current) => 
          (current.size > prev.size) ? current : prev
        )
      const activeNetwork = networkInterfaces.find(net => net.default) || networkInterfaces[0]
      
      const cpuUsage = currentLoad.currentLoad || 0
      const cpuTemp = currentLoad.cpus ? 
        (currentLoad.cpus.reduce((sum, cpu) => sum + (cpu.load || 0), 0) / currentLoad.cpus.length).toFixed(1) : 
        cpuUsage.toFixed(1)
      
      const memUsed = mem.total - mem.available
      const memUsage = ((memUsed / mem.total) * 100).toFixed(1)
      
      const systemUptime = this.formatTime(time.uptime || os.uptime())
      
      const msg = [
        `【系统状态】${moment().format('YYYY-MM-DD HH:mm:ss')}`,
        '',
        `● 系统信息`,
        `  操作系统：${osInfo.distro || osInfo.platform} ${osInfo.release || osInfo.codename || ''}`,
        `  系统架构：${osInfo.arch} / ${os.platform()}`,
        `  内核版本：${osInfo.kernel || os.release()}`,
        `  主机名称：${osInfo.hostname || os.hostname()}`,
        `  系统运行：${systemUptime}`,
        '',
        `● CPU信息`,
        `  处理器：${cpu.manufacturer} ${cpu.brand}`,
        `  核心数：${cpu.physicalCores}核心 ${cpu.cores}线程`,
        `  主频率：${cpu.speed}GHz${cpu.speedMax ? ` (最高${cpu.speedMax}GHz)` : ''}`,
        `  当前负载：${cpuTemp}%`,
        '',
        `● 内存信息`,
        `  总内存：${this.formatFileSize(mem.total)}`,
        `  已使用：${this.formatFileSize(memUsed)} (${memUsage}%)`,
        `  可用：${this.formatFileSize(mem.available)}`,
        `  缓存：${this.formatFileSize(mem.cached || 0)}`,
        `  Node占用：${this.formatFileSize(nodeUsage.rss)} (堆${this.formatFileSize(nodeUsage.heapUsed)})`,
        '',
        `● 磁盘信息`,
        mainDisk ? [
          `  挂载点：${mainDisk.mount}`,
          `  文件系统：${mainDisk.fs}`,
          `  总容量：${this.formatFileSize(mainDisk.size)}`,
          `  已使用：${this.formatFileSize(mainDisk.used)} (${mainDisk.use?.toFixed(1) || '0'}%)`,
          `  可用：${this.formatFileSize(mainDisk.available)}`
        ].join('\n') : '  无磁盘信息',
        '',
        showProcessInfo ? [
          `● 进程信息`,
          `  总进程数：${processes.all}个`,
          `  运行中：${processes.running}个`,
          `  睡眠中：${processes.sleeping}个`,
          `  阻塞：${processes.blocked}个`,
          ''
        ] : [],
        `● Bot信息`,
        `  昵称：${bot.nickname || '未知'}`,
        `  账号：${bot.uin || e.self_id}`,
        `  运行时长：${botRuntime}`,
        `  Node版本：${nodeVersion}`,
        `  插件数量：${pluginCount}个`,
        `  定时任务：${taskCount}个`,
        `  日志等级：${cfg.agt?.logging?.level || 'info'}`,
        `  日志目录：${cfg.agt?.logging?.dir || 'logs'}`
      ].flat()

      if (showNetworkInfo) {
        msg.push('', `● 网络信息`)
        msg.push(`  接口名称：${activeNetwork.iface}`)
        msg.push(`  IPv4地址：${activeNetwork.ip4 || '无'}`)
        msg.push(`  IPv6地址：${activeNetwork.ip6 || '无'}`)
        msg.push(`  MAC地址：${activeNetwork.mac || '无'}`)
      }

      await e.reply(msg.join('\n'))
      return true
    } catch (error) {
      logger.error(`获取系统状态失败: ${error.message}`)
      await e.reply('获取系统状态失败')
      return false
    }
  }
}