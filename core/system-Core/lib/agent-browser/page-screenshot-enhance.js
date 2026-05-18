import fs from 'node:fs'
import path from 'node:path'
import BotUtil from '#utils/botutil.js'

/** 推荐的高 DPI 截图设备像素比 */
export const DEFAULT_DEVICE_SCALE_FACTOR = 2

/**
 * @typedef {Object} LocalFontSpec
 * @property {string} family CSS font-family 名称
 * @property {string} file 字体文件名（位于 fontDir）
 * @property {string} [weight='400'] @font-face font-weight
 * @property {string} [loadWeight] document.fonts.load/check 用的字重，默认取 weight 首段
 */

/**
 * @typedef {Object} LocalAssetRouteSpec
 * @property {string|RegExp} match Playwright page.route 的 URL 模式（支持 ** 通配）
 * @property {string} file 本地文件名（位于 assetDir）
 * @property {string} [contentType='application/octet-stream']
 */

/**
 * @typedef {Object} LocalFontScreenshotHelperOptions
 * @property {string} fontUrlBase 与目标页同域的虚拟 URL 前缀（须以 / 结尾）
 * @property {string} fontDir 字体目录（相对 cwd 或绝对路径）
 * @property {LocalFontSpec[]} fonts
 * @property {string} [assetDir] 静态资源目录（相对 cwd 或绝对路径）
 * @property {LocalAssetRouteSpec[]} [assetRoutes] 拦截远程 URL 并回源本地文件（如图标贴图）
 * @property {string[]} [hideSelectors] 截图前 display:none 的选择器
 * @property {string} [extraCss] 追加样式（业务排版放调用方）
 * @property {string} [logContext] BotUtil.makeLog 上下文
 * @property {number} [fontWaitMs=8000] 等待字体加载超时
 */

/**
 * 创建「本地字体 + 页面样式 + 区域截图」助手（HTTPS 页通过 page.route 同源回源 fontDir）
 * @param {LocalFontScreenshotHelperOptions} options
 */
export function createLocalFontScreenshotHelper(options) {
  const {
    fontUrlBase,
    fontDir,
    fonts,
    assetDir,
    assetRoutes = [],
    hideSelectors = [],
    extraCss = '',
    logContext = 'PageScreenshot',
    fontWaitMs = 8000,
  } = options

  if (!fontUrlBase || !fontDir || !fonts?.length) {
    throw new Error('createLocalFontScreenshotHelper: fontUrlBase、fontDir、fonts 为必填')
  }

  const fontDirAbs = path.isAbsolute(fontDir) ? fontDir : path.join(process.cwd(), fontDir)
  const assetDirAbs = assetDir
    ? (path.isAbsolute(assetDir) ? assetDir : path.join(process.cwd(), assetDir))
    : null
  const baseUrl = fontUrlBase.endsWith('/') ? fontUrlBase : `${fontUrlBase}/`
  const routedPages = new WeakSet()
  /** @type {Map<string, Buffer>} */
  const binaryCache = new Map()
  let cachedCss = null

  const log = (level, msg) => BotUtil.makeLog(level, msg, logContext)

  const loadSpecs = fonts.map((f) => ({
    family: f.family,
    loadWeight: f.loadWeight || String(f.weight || '400').split(/\s+/)[0] || '400',
  }))

  function fontPublicUrl(fileName) {
    return `${baseUrl}${encodeURIComponent(fileName)}`
  }

  function readBinary(filePath) {
    if (binaryCache.has(filePath)) return binaryCache.get(filePath)
    const body = fs.readFileSync(filePath)
    binaryCache.set(filePath, body)
    return body
  }

  function buildCss() {
    if (cachedCss) return cachedCss

    const faces = []
    const stackParts = []
    for (const f of fonts) {
      const filePath = path.join(fontDirAbs, f.file)
      if (!fs.existsSync(filePath)) {
        log('warn', `跳过缺失字体: ${filePath}`)
        continue
      }
      const fmt = f.file.endsWith('.woff2') ? 'woff2' : 'truetype'
      const weight = f.weight || '400'
      faces.push(
        `@font-face{font-family:'${f.family}';src:url('${fontPublicUrl(f.file)}') format('${fmt}');font-weight:${weight};font-style:normal;font-display:block;}`
      )
      stackParts.push(`'${f.family}'`)
    }

    const fallback = "'PingFang SC','Microsoft YaHei',sans-serif"
    const stack = stackParts.length ? `${stackParts.join(',')},${fallback}` : fallback
    const hideRule = hideSelectors.length
      ? `${hideSelectors.join(',')}{display:none!important;}`
      : ''
    const baseRule = stackParts.length
      ? `.content,.content *{font-family:${stack}!important;-webkit-font-smoothing:antialiased!important;-moz-osx-font-smoothing:grayscale!important;text-rendering:geometricPrecision!important;font-synthesis:none!important;}`
      : ''

    cachedCss = [hideRule, ...faces, baseRule, extraCss].filter(Boolean).join('')
    return cachedCss
  }

  async function prepare(page) {
    if (routedPages.has(page)) return
    routedPages.add(page)

    for (const f of fonts) {
      const url = fontPublicUrl(f.file)
      await page.route(url, async (route) => {
        const filePath = path.join(fontDirAbs, f.file)
        if (!fs.existsSync(filePath)) {
          log('warn', `字体文件不存在: ${filePath}`)
          await route.abort()
          return
        }
        const ct = f.file.endsWith('.woff2') ? 'font/woff2' : 'font/ttf'
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' },
          body: readBinary(filePath),
        })
      })
    }

    if (assetDirAbs && assetRoutes.length) {
      for (const routeSpec of assetRoutes) {
        await page.route(routeSpec.match, async (route) => {
          const filePath = path.join(assetDirAbs, routeSpec.file)
          if (!fs.existsSync(filePath)) {
            log('warn', `资源文件不存在: ${filePath}`)
            await route.abort()
            return
          }
          await route.fulfill({
            status: 200,
            headers: {
              'Content-Type': routeSpec.contentType || 'application/octet-stream',
              'Cache-Control': 'public, max-age=86400',
            },
            body: readBinary(filePath),
          })
        })
      }
    }
  }

  /**
   * @param {import('playwright').Page} page
   * @returns {Promise<{ families: Record<string, boolean>, allOk: boolean }>}
   */
  async function apply(page) {
    await prepare(page)
    const css = buildCss()
    if (css) await page.addStyleTag({ content: css }).catch(() => {})

    await Promise.race([
      page.evaluate(async (specs) => {
        await Promise.all(
          specs.map(({ family, loadWeight }) => {
            const spec = `${loadWeight} 16px "${family}"`
            return document.fonts.load(spec).catch(() => {})
          })
        )
        await document.fonts.ready
      }, loadSpecs).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, fontWaitMs)),
    ])

    const families = await page.evaluate((specs) => {
      const out = /** @type {Record<string, boolean>} */ ({})
      for (const { family, loadWeight } of specs) {
        const spec = `${loadWeight} 16px "${family}"`
        out[family] = document.fonts.check(spec)
      }
      return out
    }, loadSpecs)

    const allOk = loadSpecs.every((s) => families[s.family])
    if (allOk) {
      log('info', `字体已加载: ${loadSpecs.map((s) => s.family).join(', ')}`)
    } else {
      const missing = loadSpecs.filter((s) => !families[s.family]).map((s) => s.family)
      log('warn', `字体未完全加载，缺失: ${missing.join(', ')} | ${JSON.stringify(families)}`)
    }

    await page.evaluate(() => {
      document.getAnimations?.().forEach((a) => {
        try {
          a.cancel()
        } catch {
          /* ignore */
        }
      })
    }).catch(() => {})

    return { families, allOk }
  }

  /**
   * @param {import('playwright').Page} page
   * @param {string} [selector='.content']
   * @returns {Promise<Buffer>}
   */
  async function capture(page, selector = '.content') {
    const locator = page.locator(selector).first()
    const shotOpts = {
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
    }
    return locator.screenshot(shotOpts).catch(() => page.screenshot({ ...shotOpts, fullPage: false }))
  }

  function clearCache() {
    cachedCss = null
    binaryCache.clear()
  }

  return { prepare, apply, capture, clearCache }
}
