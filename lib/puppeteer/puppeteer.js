import Renderer from '../renderer/loader.js'

/**
 * @file puppeteer.js
 * @description Puppeteer 兼容层（已废弃，保留兼容性）
 * @deprecated 请使用 renderer/loader.js 代替
 * @author XRK
 * @copyright 2025 XRK Studio
 * @license MIT
 * 
 * 此文件仅用于向后兼容，新代码应使用 Renderer.getRenderer() 获取渲染器实例
 * 
 * @deprecated 此兼容层将在未来版本中移除，请迁移到使用 renderer/loader.js
 */
let renderer = Renderer.getRenderer()
renderer.screenshot = async (name, data) => {
    let img = await renderer.render(name, data)
    return img ? segment.image(img) : img
}
renderer.screenshots = async (name, data) => {
    data.multiPage = true
    let imgs = await renderer.render(name, data) || []
    let ret = []
    for (let img of imgs) {
        ret.push(img ? segment.image(img) : img)
    }
    return ret.length > 0 ? ret : false
}

export default renderer