#!/usr/bin/env node
/**
 * 跨平台 Redis 探测与本机拉起（唯一实现）。
 * - 探测：Node net TCP（不依赖 PowerShell / WSL）
 * - Windows：服务 Memurai / Redis → 常见安装路径 → PATH
 * - Unix：PATH 上 redis-server --daemonize
 *
 * CLI: node scripts/ensure-redis.mjs
 * Env: XRK_REDIS_HOST（默认 127.0.0.1）、XRK_REDIS_PORT（默认 6379）
 */
import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function resolveTarget(opts = {}) {
  const host = opts.host || process.env.XRK_REDIS_HOST || '127.0.0.1'
  const port = Number(opts.port ?? process.env.XRK_REDIS_PORT ?? 6379) || 6379
  return { host, port }
}

/** @returns {Promise<boolean>} */
function probe(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function runDetached(exe, args = []) {
  try {
    const child = spawn(exe, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

async function cmdOk(command, args, opts = {}) {
  try {
    await execFileAsync(command, args, {
      timeout: opts.timeout ?? 15000,
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

async function winServiceRunning(name) {
  try {
    const { stdout } = await execFileAsync('sc.exe', ['query', name], {
      timeout: 8000,
      windowsHide: true
    })
    return /\bRUNNING\b/i.test(String(stdout))
  } catch {
    return false
  }
}

async function tryWinService(name) {
  if (!(await cmdOk('sc.exe', ['query', name], { timeout: 5000 }))) return false
  await cmdOk('net.exe', ['start', name], { timeout: 20000 })
  return winServiceRunning(name)
}

function whichSync(bin) {
  const pathEnv = process.env.PATH || ''
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : ['']
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = path.join(dir, bin + ext)
      if (existsSync(full)) return full
    }
    const plain = path.join(dir, bin)
    if (existsSync(plain)) return plain
  }
  return null
}

async function startWindows() {
  if (await tryWinService('Memurai')) return true
  if (await tryWinService('Redis')) return true

  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Redis', 'redis-server.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Memurai', 'memurai.exe'),
    path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Redis',
      'redis-server.exe'
    ),
    whichSync('redis-server'),
    whichSync('memurai')
  ].filter(Boolean)

  for (const exe of candidates) {
    if (!existsSync(exe)) continue
    if (runDetached(exe)) return true
  }
  return false
}

async function startUnix() {
  const redisServer = whichSync('redis-server')
  if (!redisServer) return false
  return cmdOk(
    redisServer,
    ['--save', '900', '1', '--save', '300', '10', '--daemonize', 'yes'],
    { timeout: 15000 }
  )
}

async function waitUntilReady(host, port, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await probe(host, port, 800)) return true
    await sleep(1000)
  }
  return false
}

/**
 * @param {{ host?: string, port?: number }} [opts]
 * @returns {Promise<{ ok: boolean, started: boolean, reason?: string, host: string, port: number }>}
 */
export async function ensureRedisReady(opts = {}) {
  const { host, port } = resolveTarget(opts)

  if (await probe(host, port, 500)) {
    return { ok: true, started: false, host, port }
  }

  let started = false
  if (process.platform === 'win32') {
    started = await startWindows()
  } else {
    started = await startUnix()
  }

  if (!started) {
    return { ok: false, started: false, reason: 'no-local-server', host, port }
  }

  const ready = await waitUntilReady(host, port, 20)
  return { ok: ready, started: true, reason: ready ? undefined : 'timeout', host, port }
}

async function main() {
  const result = await ensureRedisReady()
  if (result.ok) {
    console.log(`[Redis] ${result.host}:${result.port} OK`)
    process.exit(0)
  }
  if (result.reason === 'timeout') {
    console.error(`[Redis] timeout waiting for ${result.host}:${result.port}`)
  } else {
    console.error(
      `[Redis] ${result.host}:${result.port} unreachable; install Memurai / Redis MSI / redis-server, or use docker compose.`
    )
  }
  process.exit(1)
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(__filename)

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[Redis] ${err?.message || err}`)
    process.exit(1)
  })
}
