import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import yaml from "yaml"
import lodash from "lodash"
import cfg from "#infrastructure/config/config.js"
import Renderer from "./Renderer.js"
import paths from "#utils/paths.js"

// 暴露 Renderer 构造，仅一次
global.Renderer = Renderer

class RendererLoader {
  constructor() {
    this.renderers = new Map()
    this.watcher = {}
  }

  static async init() {
    const render = new RendererLoader()
    await render.load()
    return render
  }

  async load() {
    const baseDir = paths.renderers
    if (!fs.existsSync(baseDir)) {
      console.warn(`渲染器目录不存在: ${baseDir}，跳过加载`)
      return
    }

    const subFolders = fs.readdirSync(baseDir, { withFileTypes: true }).filter(d => d.isDirectory())
    for (const subFolder of subFolders) {
      const name = subFolder.name
      try {
        const indexJs = path.join(baseDir, name, "index.js")
        const configFile = path.join(baseDir, name, "config.yaml")

        const rendererFn = (await import(pathToFileURL(indexJs).href)).default
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
    return this.renderers.get(name) || {}
  }
}

export default await RendererLoader.init()