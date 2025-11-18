import fs from "node:fs/promises"
import paths from '#utils/paths.js';

/**
 * 适配器加载器
 * 负责加载core/adapter目录下的所有适配器文件
 */
class AdapterLoader {
  /**
   * 加载所有适配器文件
   * 适配器文件在模块级别会执行 Bot.adapter.push() 来注册自己
   */
  async load() {
    Bot.makeLog('info', "开始加载适配器文件...", 'AdapterLoader');
    let loadedCount = 0
    let errorCount = 0
    
    try {
      const adapterDir = paths.coreAdapter
      
      // 检查目录是否存在
      try {
        await fs.access(adapterDir)
      } catch {
        Bot.makeLog('warn', `适配器目录不存在: ${adapterDir}`, 'AdapterLoader');
        return { loaded: 0, errors: 0 }
      }
      
      const files = await fs.readdir(adapterDir)
      const adapterFiles = files.filter(file => file.endsWith(".js"))
      
      if (adapterFiles.length === 0) {
        Bot.makeLog('info', "未找到适配器文件", 'AdapterLoader');
        return { loaded: 0, errors: 0 }
      }
      
      // 记录加载前的适配器数量
      const adapterCountBefore = Bot.adapter?.length || 0
      
      // 导入所有适配器文件
      for (const file of adapterFiles) {
        try {
          Bot.makeLog('debug', `导入适配器文件: ${file}`, 'AdapterLoader');
          await import(`#core/adapter/${file}`)
          loadedCount++
        } catch (err) {
          Bot.makeLog('error', `导入适配器文件失败: ${file}`, 'AdapterLoader', err);
          errorCount++
        }
      }
      
      // 计算实际注册的适配器数量
      const adapterCountAfter = Bot.adapter?.length || 0
      const registeredCount = adapterCountAfter - adapterCountBefore
      
      Bot.makeLog('info', `适配器文件加载完成: 导入${loadedCount}个文件, 注册${registeredCount}个适配器`, 'AdapterLoader');
      
      if (errorCount > 0) {
        Bot.makeLog('warn', `有${errorCount}个适配器文件加载失败`, 'AdapterLoader');
      }
      
      return { loaded: loadedCount, registered: registeredCount, errors: errorCount }
    } catch (error) {
      Bot.makeLog('error', "加载适配器目录失败", 'AdapterLoader', error);
      return { loaded: 0, errors: 1 }
    }
  }
}

export default new AdapterLoader()

