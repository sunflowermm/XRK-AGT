import fs from 'node:fs'
import path from 'node:path'
import BotUtil from '#utils/botutil.js'

/** 推荐的高 DPI 截图设备像素比 */
export const DEFAULT_DEVICE_SCALE_FACTOR = 2

/** DOM 微调：将「标签+全角/半角冒号+数字」拆为半角冒号并收紧与数字间距 */
export const DOM_TWEAK_LABEL_COLON_HALF = 'labelColonHalf'

const LABEL_COLON_HALF_CLASS = 'pss-label-colon'
const LABEL_COLON_NUM_CLASS = 'pss-label-num'

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
 * @property {LabelColonHalfTweak[]} [domTweaks] 截图前 DOM 微调（如全角冒号改半角）
 * @property {string} [logContext] BotUtil.makeLog 上下文
 * @property {number} [fontWaitMs=8000] 等待字体加载超时
 */

/**
 * @typedef {Object} LabelColonHalfTweak
 * @property {typeof DOM_TWEAK_LABEL_COLON_HALF} kind
 * @property {string} selector 匹配含「标签：数字」的节点（常见为 em）
 * @property {string} [label='价格'] 冒号前标签文案
 * @property {string} [colonMarginRight='-0.14em'] 半角冒号与数字之间的负间距
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
    domTweaks = [],
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

  const log = (level, msg) => BotUtil.makeLog(level, msg, logContext)

  const loadSpecs = fonts.map((f) => ({
    family: f.family,
    loadWeight: f.loadWeight || String(f.weight || '400').split(/\s+/)[0] || '400',
  }))

  function fontPublicUrl(fileName) {
    return `${baseUrl}${encodeURIComponent(fileName)}`
  }

  function buildCss() {
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

    const colonHalfRules = domTweaks
      .filter((t) => t.kind === DOM_TWEAK_LABEL_COLON_HALF)
      .map((t) => {
        const gap = t.colonMarginRight ?? '-0.14em'
        return (
          `.${LABEL_COLON_HALF_CLASS}{display:inline!important;margin:0 ${gap} 0 0!important;` +
          `letter-spacing:0!important;font-variant-east-asian:normal!important;}` +
          `.${LABEL_COLON_NUM_CLASS}{margin-left:0!important;letter-spacing:0!important;}`
        )
      })

    return [hideRule, ...faces, baseRule, ...colonHalfRules, extraCss].filter(Boolean).join('')
  }

  async function applyDomTweaks(page) {
    const colonTweaks = domTweaks.filter((t) => t.kind === DOM_TWEAK_LABEL_COLON_HALF)
    if (!colonTweaks.length) return

    await page.evaluate(
      ({ tweaks, colonClass, numClass }) => {
        for (const { selector, label = '价格' } of tweaks) {
          const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const re = new RegExp(`^\\s*${escaped}\\s*([：:])\\s*(\\d+)\\s*$`)
          document.querySelectorAll(selector).forEach((el) => {
            const text = (el.textContent || '').replace(/\s+/g, ' ')
            const m = text.match(re)
            if (!m) return
            el.innerHTML =
              `${label}<span class="${colonClass}">:</span> <span class="${numClass}">${m[2]}</span>`
          })
        }
      },
      {
        tweaks: colonTweaks.map((t) => ({ selector: t.selector, label: t.label })),
        colonClass: LABEL_COLON_HALF_CLASS,
        numClass: LABEL_COLON_NUM_CLASS,
      }
    )
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
          body: fs.readFileSync(filePath),
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
            headers: { 'Content-Type': routeSpec.contentType || 'application/octet-stream' },
            body: fs.readFileSync(filePath),
          })
        })
      }
    }
  }

  /** @param {import('playwright').Page} page */
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

    const missing = loadSpecs.filter((s) => !families[s.family]).map((s) => s.family)
    if (missing.length) {
      log('warn', `字体未完全加载: ${missing.join(', ')}`)
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

    await applyDomTweaks(page)
  }

  /** @param {import('playwright').Page} page @param {string} [selector='.content'] */
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

  return { prepare, apply, capture }
}
