import { normalizeError } from '#utils/normalize-error.js'
import {
  formatSubserverCommandResult,
  parseSubserverCommandLine,
  subserverRuntimeUsageHint
} from '#utils/subserver-runtimes.js'
import { getSubserverDefaultRuntime } from '#utils/subserver-client.js'

const TIMEOUT_MS = 120_000
const CMD_RE = /^#?(?:子服|sub)\s*(.*)$/i

export class SubserverCliPlugin extends plugin {
  constructor() {
    super({
      name: '子服务命令',
      dsc: '转发 #子服 到 Python/Go/PHP/Java/.NET/Rust 子服务',
      event: 'message',
      priority: 4500,
      rule: [{ reg: CMD_RE, fnc: 'runCommand' }]
    })
  }

  async runCommand() {
    const match = CMD_RE.exec(this.e.msg || '')
    const line = (match?.[1] || '').trim()
    if (!line) {
      await this.reply(subserverRuntimeUsageHint())
      return false
    }
    return this._dispatch(line)
  }

  async _dispatch(line) {
    const { runtime, commandLine } = parseSubserverCommandLine(line, getSubserverDefaultRuntime())
    try {
      const result = await Bot.callSubserver('/api/system/command', {
        method: 'POST',
        body: { line: commandLine },
        timeout: TIMEOUT_MS,
        runtime
      })
      const prefix = runtime === 'pyserver' ? '' : `[${runtime}] `
      await this.reply(prefix + formatSubserverCommandResult(result))
      return true
    } catch (err) {
      const error = normalizeError(err)
      logger.error(`[子服务命令] ${runtime}: ${error.message}`)
      await this.reply(
        `子服务 ${runtime} 调用失败: ${error.message}\n` +
        '请在 CommonConfig → AIStream → 子服务端 检查地址端口，并确认对应进程已启动'
      )
      return false
    }
  }
}

export default SubserverCliPlugin
