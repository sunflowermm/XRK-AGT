import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import yaml from "yaml"
import lodash from "lodash"
import chokidar from "chokidar"
import cfg from "#infrastructure/config/config.js"
import Renderer from "./Renderer.js"
import paths from "#utils/paths.js"
import BotUtil from "#utils/botutil.js"

// 暴露 Renderer 构造，仅一次
global.Renderer = Renderer

class RendererLoader {
  constructor() {
    this.renderers = new Map()
    this.watcher = null
  }

  static async init() {
    const render = new RendererLoader()
    await render.load()
    return render
  }

  async load() {
    const baseDir = paths.renderers
    if (!fs.existsSync(baseDir)) {
      BotUtil.makeLog('warn', `渲染器目录不存在: ${baseDir}，跳过加载`, 'RendererLoader');
      return
    }

    const subFolders = fs.readdirSync(baseDir, { withFileTypes: true }).filter(d => d.isDirectory())
    for (const subFolder of subFolders) {
      const name = subFolder.name
      try {
        await this._loadRenderer(name, baseDir)
      } catch (err) {
        BotUtil.makeLog('error', `渲染器加载失败: ${name} - ${err.message}`, 'RendererLoader', err);
      }
    }
  }

  async _loadRenderer(name, baseDir) {
    const indexJs = path.join(baseDir, name, "index.js")
    const configFile = path.join(baseDir, name, "config.yaml")

    if (!fs.existsSync(indexJs)) return

    const rendererFn = (await import(pathToFileURL(indexJs).href)).default
    const rendererCfg = fs.existsSync(configFile) ? yaml.parse(fs.readFileSync(configFile, "utf8")) : {}
    const renderer = rendererFn(rendererCfg)

    if (!renderer.id || !renderer.type || !renderer.render || !lodash.isFunction(renderer.render)) {
      BotUtil.makeLog('warn', `渲染器配置无效: ${name}`, 'RendererLoader');
      return false
    }
    this.renderers.set(renderer.id, renderer)
    return true
  }

  getRenderer(name = cfg.renderer?.name || "puppeteer") {
    return this.renderers.get(name) || {}
  }

  /**
   * 启用文件监视（热加载）
   * @param {boolean} enable - 是否启用
   */
  async watch(enable = true) {
    if (!enable) {
      if (this.watcher) {
        await this.watcher.close()
        this.watcher = null
      }
      return
    }

    if (this.watcher) return

    const baseDir = paths.renderers
    if (!fs.existsSync(baseDir)) return

    try {
      this.watcher = chokidar.watch(baseDir, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      })

      this.watcher
        .on('addDir', lodash.debounce(async (dirPath) => {
          try {
            const name = path.basename(dirPath)
            await this._loadRenderer(name, baseDir)
          } catch (error) {
            BotUtil.makeLog('error', '处理新增渲染器失败', 'RendererLoader', error);
          }
        }, 500))
        .on('change', lodash.debounce(async (filePath) => {
          try {
            const dirName = path.basename(path.dirname(filePath))
            const fileName = path.basename(filePath)
            
            if (fileName === 'index.js' || fileName === 'config.yaml') {
              await this._loadRenderer(dirName, baseDir)
            }
          } catch (error) {
            BotUtil.makeLog('error', '处理渲染器变更失败', 'RendererLoader', error);
          }
        }, 500))
        .on('unlinkDir', lodash.debounce(async (dirPath) => {
          try {
            const name = path.basename(dirPath)
            this.renderers.delete(name)
          } catch (error) {
            BotUtil.makeLog('error', '处理渲染器删除失败', 'RendererLoader', error);
          }
        }, 500))
    } catch (error) {
      BotUtil.makeLog('error', '启动渲染器文件监视失败', 'RendererLoader', error);
    }
  }
}

export default await RendererLoader.init()