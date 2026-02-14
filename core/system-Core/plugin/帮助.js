export class Help extends plugin {
  constructor() {
    super({
      name: '帮助',
      dsc: '发送 #帮助 获取帮助页截图',
      event: 'message',
      priority: 4000,
      rule: [{ reg: '^#帮助$', fnc: 'help' }]
    })
  }

  async help() {
    const data = {
      saveId: `help_${Date.now()}`,
      imgType: 'png',
      quality: 100,
      title: 'XRK-AGT 帮助',
      subtitle: '多端统一事件链 · QQ / 设备 / Web / 终端',
      sections: [
        {
          name: '常用',
          items: [
            { cmd: '#帮助', desc: '本帮助页' },
            { cmd: '#状态', desc: '系统状态' },
            { cmd: '#更新', desc: '更新 Core' },
            { cmd: '#重启', desc: '重启服务(主人)' },
            { cmd: '#关机/#开机', desc: '停机/恢复(主人)' }
          ]
        },
        {
          name: '更新与日志',
          items: [
            { cmd: '#强制更新', desc: '强制更新' },
            { cmd: '#全部更新', desc: '静默全部更新' },
            { cmd: '#查看日志', desc: '更新日志' },
            { cmd: '#日志[N]', desc: '运行/错误/追踪日志' }
          ]
        },
        {
          name: '消息与违禁词',
          items: [
            { cmd: '#添加/#删除', desc: '消息词条' },
            { cmd: '#消息/#词条', desc: '列表' },
            { cmd: '#违禁词', desc: '增加/删除/列表/开启关闭' },
            { cmd: '#清空违禁词', desc: '清空(主人)' }
          ]
        },
        {
          name: '终端与脚本',
          items: [
            { cmd: 'rx <cmd>', desc: '项目目录执行' },
            { cmd: 'rh <cmd>', desc: '用户主目录执行' },
            { cmd: 'roj <code>', desc: 'JavaScript 执行' },
            { cmd: 'roi <expr>', desc: '对象检查' },
            { cmd: 'rj <expr>', desc: '快速表达式' },
            { cmd: 'rrl [n]', desc: '命令历史' },
            { cmd: 'rc [set]', desc: '工具配置' }
          ]
        },
        {
          name: '其他',
          items: [
            { cmd: '#点歌 歌名', desc: '搜索分享歌曲' },
            { cmd: '#复读', desc: '主动复读' }
          ]
        },
        {
          name: '设备 / Web',
          full: true,
          items: [
            { cmd: 'Event 对话', desc: '戳一戳、发消息走事件链(OneBot v11 notice/message)' },
            { cmd: 'AI 对话', desc: '与工作流对话' }
          ]
        }
      ],
      footer: 'XRK-AGT · 使用项目渲染器生成'
    }
    try {
      const result = await this.e.runtime.render('帮助', 'help', data, { retType: 'base64' })
      await this.reply(result || '生成帮助页失败。')
    } catch (err) {
      logger.error(`[帮助] 渲染失败: ${err.message}`)
      await this.reply('生成帮助页时出错，请检查渲染器配置。')
    }
    return true
  }
}
