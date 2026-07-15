/**
 * AiStreamLoader 宿主解析：打断 PluginBase / AiWorkflow ↔ loader 顶层循环依赖。
 * loader 单例构造后调用 setAiStreamHost(instance)。
 */
import { setRuntimeGlobal } from '#utils/runtime-globals.js'

let host = null

export function setAiStreamHost(instance) {
  host = instance || null
  if (host) setRuntimeGlobal('AiStreamLoader', host)
}

export function getAiStreamHost() {
  return host || globalThis.AiStreamLoader || null
}
