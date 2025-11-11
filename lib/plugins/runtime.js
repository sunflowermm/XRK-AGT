/**
 * 葵崽 的 plugin 的 runtime，可通过 e.runtime 访问
 * 核心运行时，不包含游戏特定功能
 */
import lodash from "lodash"
import fs from "node:fs/promises"
import common from "../common/common.js"
import cfg from "../config/config.js"
import puppeteer from "../puppeteer/puppeteer.js"
import Handler from "./handler.js"

/**
 * 运行时扩展注册器
 */
class RuntimeExtensionRegistry {
  constructor() {
    this.extensions = new Map()
  }

  /**
   * 注册运行时扩展
   * @param {string} name 扩展名称
   * @param {Function} extension 扩展类或函数
   */
  register(name, extension) {
    this.extensions.set(name, extension)
    logger.info(`[Runtime] 注册扩展: ${name}`)
  }

  /**
   * 获取扩展
   * @param {string} name 扩展名称
   */
  get(name) {
    return this.extensions.get(name)
  }

  /**
   * 检查扩展是否存在
   * @param {string} name 扩展名称
   */
  has(name) {
    return this.extensions.has(name)
  }

  /**
   * 获取所有扩展
   */
  getAll() {
    return Array.from(this.extensions.entries())
  }
}

const extensionRegistry = new RuntimeExtensionRegistry()

/**
 * 核心运行时类
 */
export default class Runtime {
  constructor(e) {
    this.e = e
    this._extensions = {}

    this.handler = {
      has: Handler.has,
      call: Handler.call,
      callAll: Handler.callAll
    }

    // 动态加载已注册的扩展
    this._loadExtensions()
  }

  /**
   * 加载所有已注册的扩展
   */
  _loadExtensions() {
    for (const [name, Extension] of extensionRegistry.getAll()) {
      try {
        if (typeof Extension === 'function') {
          // 如果是类，创建实例
          if (Extension.prototype) {
            this._extensions[name] = new Extension(this.e, this)
          } else {
            // 如果是函数，直接调用
            const ext = Extension(this.e, this)
            if (ext) {
              this._extensions[name] = ext
            }
          }
        } else if (typeof Extension === 'object') {
          // 如果是对象，直接使用
          this._extensions[name] = Extension
        }
      } catch (error) {
        logger.error(`[Runtime] 加载扩展 ${name} 失败: ${error.message}`)
      }
    }
  }

  /**
   * 获取扩展实例
   * @param {string} name 扩展名称
   */
  getExtension(name) {
    return this._extensions[name]
  }

  get cfg() {
    return cfg
  }

  get common() {
    return common
  }

  get puppeteer() {
    return puppeteer
  }

  /**
   * 代理访问扩展的属性
   */
  get game() {
    return this.getExtension('game')
  }

  /**
   * 渲染方法
   * @param plugin plugin key
   * @param path html文件路径，相对于plugin resources目录
   * @param data 渲染数据
   * @param cfg 渲染配置
   * @param cfg.retType 返回值类型
   * * default/空：自动发送图片，返回true
   * * msgId：自动发送图片，返回msg id
   * * base64: 不自动发送图像，返回图像base64数据
   * @param cfg.beforeRender({data}) 可改写渲染的data数据
   * @returns {Promise<boolean>}
   */
  async render(plugin, path, data = {}, cfg = {}) {
    // 处理传入的path
    path = path.replace(/.html$/, "")
    let paths = lodash.filter(path.split("/"), (p) => !!p)
    path = paths.join("/")
    
    // 创建目录
    await Bot.mkdir(`temp/html/${plugin}/${path}`)
    
    // 自动计算pluResPath
    let pluResPath = `../../../${lodash.repeat("../", paths.length)}plugins/${plugin}/resources/`
    
    // 基础渲染data
    data = {
      sys: {
        scale: 1
      },
      _res_path: pluResPath,
      _plugin: plugin,
      _htmlPath: path,
      pluResPath,
      tplFile: `./plugins/${plugin}/resources/${path}.html`,
      saveId: data.saveId || data.save_id || paths[paths.length - 1],
      ...data
    }

    // 让扩展添加自己的渲染数据
    for (const [name, ext] of Object.entries(this._extensions)) {
      if (ext && typeof ext.enhanceRenderData === 'function') {
        data = await ext.enhanceRenderData(data, plugin, path) || data
      }
    }
    
    // 处理beforeRender
    if (cfg.beforeRender) {
      data = cfg.beforeRender({ data }) || data
    }
    
    // 保存模板数据（开发模式）
    if (process.argv.includes("dev")) {
      let saveDir = await Bot.mkdir(`temp/ViewData/${plugin}`)
      let file = `${saveDir}/${data._htmlPath.split("/").join("_")}.json`
      await fs.writeFile(file, JSON.stringify(data))
    }
    
    // 截图
    let base64 = await puppeteer.screenshot(`${plugin}/${path}`, data)
    if (cfg.retType === "base64") {
      return base64
    }
    
    let ret = true
    if (base64) {
      if (cfg.recallMsg) {
        ret = await this.e.reply(base64, false, {})
      } else {
        ret = await this.e.reply(base64)
      }
    }
    return cfg.retType === "msgId" ? ret : true
  }

  /**
   * 静态初始化方法
   */
  static async init(e) {
    // 初始化扩展
    for (const [name, Extension] of extensionRegistry.getAll()) {
      if (Extension.initCache && typeof Extension.initCache === 'function') {
        try {
          await Extension.initCache()
        } catch (error) {
          logger.error(`[Runtime] 扩展 ${name} 缓存初始化失败: ${error.message}`)
        }
      }
    }

    e.runtime = new Runtime(e)
    
    for (const [name, ext] of Object.entries(e.runtime._extensions)) {
      if (ext && typeof ext.init === 'function') {
        try {
          await ext.init()
        } catch (error) {
          logger.error(`[Runtime] 扩展 ${name} 初始化失败: ${error.message}`)
        }
      }
    }
    
    return e.runtime
  }

  /**
   * 注册扩展（静态方法）
   */
  static registerExtension(name, extension) {
    extensionRegistry.register(name, extension)
  }

  /**
   * 检查扩展是否已注册（静态方法）
   */
  static hasExtension(name) {
    return extensionRegistry.has(name)
  }
}

/**
 * 导出注册器供外部使用
 */
export { extensionRegistry }