import schedule from 'node-schedule'

export const scheduleMethods = {
  /**
   * 注册插件定时任务
   * @param {Object} plugin - 插件实例
   * @param {string} pluginName - 插件名称
   * @param {string} pluginKey - 插件文件键名（用于卸载时匹配）
   */
  registerPluginTasks(plugin, pluginName, pluginKey) {
    if (!plugin.task) return

    const tasks = Array.isArray(plugin.task) ? plugin.task : [plugin.task]
    tasks.forEach(t => {
      if (!t?.cron || !t.fnc) return

      let fnc = t.fnc
      // 字符串 fnc 解析到插件实例方法（勿查 PluginBase 类上不存在的方法名）
      if (typeof fnc === 'string') {
        if (typeof plugin[fnc] !== 'function') {
          logger.warn(`定时任务 ${t.name || pluginName} 的 fnc「${fnc}」不是插件实例方法，已跳过`)
          return
        }
        fnc = plugin[fnc].bind(plugin)
      } else if (typeof fnc !== 'function') {
        logger.warn(`定时任务 ${t.name || pluginName} 的 fnc 不是函数或函数名无效，已跳过`)
        return
      }

      this.task.push({
        name: pluginKey, // 使用插件键名，便于卸载时精确匹配
        taskName: t.name || pluginName, // 保存原始任务名称用于日志
        cron: t.cron,
        fnc,
        // 默认可静默；挂机刷屏多因默认真导致「开始执行/执行完成」刷 console
        log: t.log === true
      })
    })
  },

  createTask() {
    const scheduleKey = this.task
      .map((t) => `${t.name}\0${t.cron}\0${t.taskName ?? ''}\0${t.log ? 1 : 0}`)
      .sort()
      .join('\n')
    if (scheduleKey === this._taskScheduleKey) return
    this._taskScheduleKey = scheduleKey

    const created = new Set()

    for (const task of this.task) {
      task.job?.cancel()

      // 使用任务名称（如果有）或插件键名
      const taskDisplayName = task.taskName || task.name
      const name = `[${taskDisplayName}][${task.cron}]`
      if (created.has(name)) {
        logger.warn(`重复定时任务 ${name} 已跳过`)
        continue
      }

      created.add(name)
      logger.debug(`加载定时任务 ${name}`)

      const cronExp = task.cron.split(/\s+/).slice(0, 6).join(' ')
      task.job = schedule.scheduleJob(cronExp, async () => {
        try {
          const start = Date.now()
          if (task.log) logger.mark(`${name} 开始执行`)
          await task.fnc()
          if (task.log) logger.mark(`${name} 执行完成 ${Date.now() - start}ms`)
        } catch (err) {
          logger.error(`定时任务 ${name} 执行失败`, err)
        }
      })
    }
  }
}
