/**
 * AiWorkflowLoader 宿主解析：打断 PluginBase / AiWorkflow ↔ loader 顶层循环依赖。
 * loader 单例构造后调用 setAiWorkflowHost(instance)。
 */
import { setRuntimeGlobal } from '#utils/runtime-globals.js'

let host = null

export function setAiWorkflowHost(instance) {
  host = instance || null
  if (host) setRuntimeGlobal('AiWorkflowLoader', host)
}

export function getAiWorkflowHost() {
  return host || globalThis.AiWorkflowLoader || null
}
