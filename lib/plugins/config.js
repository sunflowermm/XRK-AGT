import fs from "node:fs/promises"
import YAML from "yaml"
import _ from "lodash"
import chokidar from "chokidar"
import cfg from "../config/config.js"
import util from "../util.js"
import path from "path"

const map = new Map

/**
 * 监听配置文件变化
 * @this {object} config 配置对象
 * @this {string} configFile 配置文件路径
 * @this {object} defaultConfig 默认配置对象
 * @this {string} defaultConfigFile 默认配置文件路径
 */
export async function watcher() {
  try {
    logger.debug("配置文件", this.configFile, "发生变化")
    const configData = YAML.parse(await fs.readFile(this.configFile, "utf8"))
    if (this.defaultConfig) {
      Object.keys(this.config).forEach(key => delete this.config[key])
      _.merge(this.config, this.defaultConfig, configData)
    } else {
      _.merge(this.config, configData)
    }
  } catch (err) {
    logger.error("配置文件", this.configFile, "读取失败", err)
  }
}

/**
 * 监听默认配置文件变化
 */
export async function watcherDefault() {
  try {
    logger.debug("默认配置文件", this.defaultConfigFile, "发生变化")
    const defaultData = YAML.parse(await fs.readFile(this.defaultConfigFile, "utf8"))
    
    // 更新默认配置
    Object.keys(this.defaultConfig).forEach(key => delete this.defaultConfig[key])
    _.merge(this.defaultConfig, defaultData)
    
    // 重新合并配置
    Object.keys(this.config).forEach(key => delete this.config[key])
    _.merge(this.config, this.defaultConfig)
    
    try {
      const serverData = YAML.parse(await fs.readFile(this.configFile, "utf8"))
      _.merge(this.config, serverData)
    } catch (err) {
    }
  } catch (err) {
    logger.error("默认配置文件", this.defaultConfigFile, "读取失败", err)
  }
}

/**
 * 确保目录存在
 */
async function ensureDir(dir) {
  try {
    await fs.access(dir)
  } catch {
    await fs.mkdir(dir, { recursive: true })
  }
}

/**
 * 获取服务器端口号
 */
function getServerPort() {
  const portIndex = process.argv.indexOf('server')
  if (portIndex !== -1 && process.argv[portIndex + 1]) {
    return parseInt(process.argv[portIndex + 1])
  }
  return null
}

/**
 * 创建配置文件（服务器模式）
 * @param {string} name 配置文件名
 * @param {object} config 配置文件默认值
 * @param {object} keep 保持不变的配置
 * @param {object} opts 配置选项
 * @param {boolean} opts.watch 是否监听配置文件变化
 * @param {function} opts.replacer 配置文本替换函数
 * @param {number} opts.port 指定端口号（覆盖自动检测）
 * @returns {Promise<{config: object, configSave: function}>}
 */
export default async function makeConfig(name, config = {}, keep = {}, opts = {}) {
  // 获取端口号
  const port = opts.port || getServerPort()
  if (!port) {
    throw new Error('服务器端口未指定，请通过命令行参数 server [port] 或 opts.port 指定')
  }
  
  // 生成缓存键
  const cacheKey = `server.${port}.${name}`
  if (map.has(cacheKey)) return map.get(cacheKey)

  const PATHS = {
    DEFAULT_CONFIG: path.join('config', 'default_config'),
    SERVER_BOTS: path.join('data', 'server_bots')
  }

  // 确定配置文件路径
  const serverConfigDir = path.join(PATHS.SERVER_BOTS, String(port))
  await ensureDir(serverConfigDir)
  const configFile = path.join(serverConfigDir, `${name}.yaml`)
  const defaultConfigFile = path.join(PATHS.DEFAULT_CONFIG, `${name}.yaml`)

  // 配置保存函数
  const configSave = util.debounce(typeof opts.replacer === "function" ?
    async () => {
      await ensureDir(path.dirname(configFile))
      await fs.writeFile(configFile, await opts.replacer(YAML.stringify(config)), "utf8")
    } :
    async () => {
      await ensureDir(path.dirname(configFile))
      await fs.writeFile(configFile, YAML.stringify(config), "utf8")
    }
  )

  const ret = { 
    config, 
    configSave, 
    configFile,
    defaultConfig: null,
    defaultConfigFile,
    port
  }
  map.set(cacheKey, ret)

  // 先加载默认配置
  let defaultData = {}
  try {
    defaultData = YAML.parse(await fs.readFile(defaultConfigFile, "utf8"))
    ret.defaultConfig = _.cloneDeep(defaultData)
  } catch (err) {
    logger.debug("默认配置文件", defaultConfigFile, "读取失败", err)
    // 如果默认配置不存在，尝试创建
    try {
      await ensureDir(path.dirname(defaultConfigFile))
      await fs.writeFile(defaultConfigFile, YAML.stringify(config), "utf8")
      ret.defaultConfig = _.cloneDeep(config)
      defaultData = config
    } catch (writeErr) {
      logger.error("创建默认配置文件失败", defaultConfigFile, writeErr)
    }
  }

  // 加载服务器配置
  let configData
  try {
    configData = YAML.parse(await fs.readFile(configFile, "utf8"))
  } catch (err) {
    logger.debug("配置文件", configFile, "读取失败", err)
    // 配置文件不存在，从默认配置复制
    if (defaultData) {
      configData = _.cloneDeep(defaultData)
    }
  }

  // 合并配置：默认配置 -> 用户传入的config -> 文件中的配置 -> keep配置
  Object.keys(config).forEach(key => delete config[key])
  if (ret.defaultConfig) _.merge(config, ret.defaultConfig)
  if (configData) _.merge(config, configData)
  _.merge(config, keep)

  // 保存配置（如果有变化）
  const currentYAML = YAML.stringify(config)
  const fileYAML = configData ? YAML.stringify(configData) : null
  if (currentYAML !== fileYAML) {
    await configSave()
  }

  // 设置文件监听
  if (typeof opts.watch === "boolean" ? opts.watch : cfg.bot.file_watch) {
    // 监听服务器配置文件
    ret.watcher = chokidar.watch(configFile).on("change", _.debounce(watcher.bind(ret), 5000))
    
    // 监听默认配置文件
    ret.defaultWatcher = chokidar.watch(defaultConfigFile).on("change", _.debounce(watcherDefault.bind(ret), 5000))
  }

  // 添加销毁方法
  ret.destroy = function() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.defaultWatcher) {
      this.defaultWatcher.close()
      this.defaultWatcher = null
    }
    map.delete(cacheKey)
  }

  return ret
}

/**
 * 销毁所有配置监听器
 */
export function destroyAll() {
  for (const [key, config] of map) {
    if (config.destroy) {
      config.destroy()
    }
  }
  map.clear()
}

/**
 * 获取指定端口的配置
 * @param {string} name 配置名称
 * @param {number} port 端口号
 */
export function getServerConfig(name, port) {
  const cacheKey = `server.${port}.${name}`
  return map.get(cacheKey)
}

/**
 * 获取所有已加载的配置
 */
export function getAllConfigs() {
  return new Map(map)
}

/**
 * 复制默认配置到服务器目录
 * @param {number} port 端口号
 */
export async function initServerConfigs(port) {
  const PATHS = {
    DEFAULT_CONFIG: path.join('config', 'default_config'),
    SERVER_BOTS: path.join('data', 'server_bots')
  }
  
  const serverConfigDir = path.join(PATHS.SERVER_BOTS, String(port))
  await ensureDir(serverConfigDir)
  
  try {
    const files = await fs.readdir(PATHS.DEFAULT_CONFIG)
    
    for (const file of files) {
      if (file.endsWith('.yaml')) {
        const defaultFile = path.join(PATHS.DEFAULT_CONFIG, file)
        const serverFile = path.join(serverConfigDir, file)
        
        try {
          await fs.access(serverFile)
          // 文件已存在，跳过
        } catch {
          // 文件不存在，复制
          const content = await fs.readFile(defaultFile, 'utf8')
          await fs.writeFile(serverFile, content, 'utf8')
          logger.debug(`复制默认配置文件 ${file} 到服务器 ${port}`)
        }
      }
    }
  } catch (err) {
    logger.error('初始化服务器配置失败', err)
  }
}