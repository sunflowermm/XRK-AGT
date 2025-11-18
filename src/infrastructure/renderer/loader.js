import fs from "node:fs"
import yaml from "yaml"
import lodash from "lodash"
import cfg from "../config/config.js"
import Renderer from "./Renderer.js"

/** 全局变量 Renderer */
global.Renderer = Renderer

/**
 * 加载渲染器
 */
class RendererLoader {
  constructor() {
    this.renderers = new Map()
    this.dir = "src/renderers"
    this.watcher = {}
  }

  static async init() {
    const render = new RendererLoader()
    await render.load()
    return render
  }

  async load() {
    // 检查渲染器目录是否存在
    if (!fs.existsSync(this.dir)) {
      console.warn(`渲染器目录不存在: ${this.dir}，跳过加载`)
      return
    }

    const subFolders = fs.readdirSync(this.dir, { withFileTypes: true }).filter((dirent) => dirent.isDirectory())
    for (const subFolder of subFolders) {
      const name = subFolder.name
      try {
        const rendererFn = (await import(`../../${this.dir}/${name}/index.js`)).default
        const configFile = `${this.dir}/${name}/config.yaml`
        const rendererCfg = fs.existsSync(configFile) ? yaml.parse(fs.readFileSync(configFile, "utf8")) : {}
        const renderer = rendererFn(rendererCfg)
        if (!renderer.id || !renderer.type || !renderer.render || !lodash.isFunction(renderer.render)) {
          console.warn(`渲染器配置无效: ${name}`)
          continue
        }
        this.renderers.set(renderer.id, renderer)
      } catch (err) {
        console.error(`渲染器加载失败: ${name}`, err.message)
      }
    }
  }

  getRenderer(name = cfg.renderer?.name || "puppeteer") {
    // TODO 渲染器降级
    return this.renderers.get(name) || {}
  }
}

export default await RendererLoader.init()