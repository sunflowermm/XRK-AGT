import os from 'os';
import si from 'systeminformation';
import cfg from '../../lib/config/config.js';

let __lastNetSample = null;
let __netSampler = null;
let __netHist = [];
const NET_HISTORY_LIMIT = 24 * 60;
const NET_SAMPLE_MS = 3_000; // 单一方法：systeminformation 网络采样，每3秒

// CPU 采样缓存（单一方法：os.cpus 快照法）
let __cpuCache = { percent: 0, ts: 0 };
let __cpuTimer = null;
let __cpuPrevSnap = null;
function __sampleCpuOnce() {
  try {
    const cpus = os.cpus();
    if (!cpus || cpus.length === 0) return;
    if (!__cpuPrevSnap) { __cpuPrevSnap = cpus; return; }
    let idleDelta = 0, totalDelta = 0;
    for (let i = 0; i < cpus.length; i++) {
      const t1 = __cpuPrevSnap[i].times, t2 = cpus[i].times;
      const idle = Math.max(0, t2.idle - t1.idle);
      const total = Math.max(0,
        (t2.user - t1.user) + (t2.nice - t1.nice) + (t2.sys - t1.sys) + (t2.irq - t1.irq) + idle
      );
      idleDelta += idle; totalDelta += total;
    }
    __cpuPrevSnap = cpus;
    if (totalDelta > 0) {
      const usedPct = +(((totalDelta - idleDelta) / totalDelta) * 100).toFixed(2);
      __cpuCache = { percent: usedPct, ts: Date.now() };
    }
  } catch {}
}

let __fsCache = { disks: [], ts: 0 };
let __procCache = { top5: [], ts: 0 };
let __fsTimer = null;
let __procTimer = null;

async function __sampleNetOnce() {
  try {
    const stats = await si.networkStats().catch(() => []);
    let rxBytes = 0, txBytes = 0;
    if (Array.isArray(stats)) {
      for (const n of stats) {
        rxBytes += Number(n.rx_bytes || 0);
        txBytes += Number(n.tx_bytes || 0);
      }
    }
    const now = Date.now();
    const tsMin = Math.floor(now / 60000) * 60000;
    let rxSec = 0, txSec = 0;
    if (__lastNetSample) {
      const dt = Math.max(1, (now - __lastNetSample.ts) / 1000);
      const rxDelta = rxBytes - __lastNetSample.rx;
      const txDelta = txBytes - __lastNetSample.tx;
      if (rxDelta >= 0) rxSec = rxDelta / dt;
      if (txDelta >= 0) txSec = txDelta / dt;
    }
    __lastNetSample = { ts: now, rx: rxBytes, tx: txBytes };
    if (__netHist.length && __netHist[__netHist.length - 1].ts === tsMin) {
      __netHist[__netHist.length - 1] = { ts: tsMin, rxSec, txSec };
    } else {
      __netHist.push({ ts: tsMin, rxSec, txSec });
      if (__netHist.length > NET_HISTORY_LIMIT) __netHist.shift();
    }
  } catch {}
}

function __ensureNetSampler() {
  if (__netSampler) return;
  // 预热两次，避免首次为0
  (async () => {
    await __sampleNetOnce();
    setTimeout(__sampleNetOnce, 1_000);
  })();
  __netSampler = setInterval(__sampleNetOnce, NET_SAMPLE_MS);
}

function __getNetHistory24h() {
  const now = Date.now();
  const start = Math.floor((now - 24 * 60 * 60 * 1000) / 60000) * 60000;
  const map = new Map(__netHist.map(p => [p.ts, p]));
  const arr = [];
  for (let i = 0; i < 24 * 60; i++) {
    const t = start + i * 60000;
    const v = map.get(t);
    if (v) arr.push({ ts: t, rxSec: v.rxSec, txSec: v.txSec }); else arr.push({ ts: t, rxSec: 0, txSec: 0 });
  }
  return arr;
}

async function __refreshFsCache() {
  try {
    const fsSize = await si.fsSize().catch(() => []);
    const disks = Array.isArray(fsSize) ? fsSize.map(d => ({
      fs: d.fs || d.mount || d.type || 'disk',
      mount: d.mount || d.fs || '',
      size: Number(d.size || 0),
      used: Number(d.used || 0),
      use: Number(d.use || 0)
    })) : [];
    __fsCache = { disks, ts: Date.now() };
  } catch {}
}

async function __refreshProcCache() {
  try {
    const procs = await si.processes().catch(() => ({ list: [] }));
    const list = procs?.list || [];
    // 计算Top5（按CPU，其次内存）
    const top5 = list
      .map(p => ({ pid: p.pid, name: p.name, cpu: Number(p.pcpu || p.cpu || 0), mem: Number(p.pmem || p.mem || 0) }))
      .sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
      .slice(0, 5);
    __procCache = { top5, ts: Date.now() };
  } catch {}
}

function __ensureSysSamplers() {
  if (!__fsTimer) {
    __refreshFsCache();
    __fsTimer = setInterval(__refreshFsCache, 30_000);
  }
  if (!__procTimer) {
    __refreshProcCache();
    __procTimer = setInterval(__refreshProcCache, 10_000);
  }
  if (!__cpuTimer) {
    __cpuPrevSnap = os.cpus();
    setTimeout(__sampleCpuOnce, 600); // 预热一次，避免首次为0
    __cpuTimer = setInterval(__sampleCpuOnce, 2_000);
  }
}

/**
 * 核心系统API
 * 提供系统状态、配置查询、健康检查等基础功能
 */
export default {
  name: 'core',
  dsc: '核心系统API',
  priority: 200,
  init: async (app, Bot) => {
    __ensureNetSampler();
    __ensureSysSamplers();
  },

  routes: [
    {
      method: 'GET',
      path: '/api/system/status',
      handler: async (req, res, Bot) => {
        try {
          // 仅使用同一方法的缓存；若缓存过期则触发一次轻量采样
          if (!__cpuCache.ts || (Date.now() - __cpuCache.ts > 5_000)) {
            __sampleCpuOnce();
          }
          const cpuPct = __cpuCache.percent || 0;

          // 基础信息（极快）
          const cpus = os.cpus();
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const usedMem = totalMem - freeMem;
          const memUsage = process.memoryUsage();

          // 交换分区（允许为空，但不阻塞）
          const siMem = await si.mem().catch(() => ({}));

          // 网络字节与速率：仅使用采样缓存
          const lastNet = __lastNetSample || { ts: Date.now(), rx: 0, tx: 0 };
          const rxBytes = Number(lastNet.rx || 0);
          const txBytes = Number(lastNet.tx || 0);
          const lastHist = __netHist.length ? __netHist[__netHist.length - 1] : { rxSec: 0, txSec: 0 };
          const rxSec = Number(lastHist.rxSec || 0);
          const txSec = Number(lastHist.txSec || 0);

          // 磁盘 & 进程：直接使用缓存，必要时后台刷新
          const disks = Array.isArray(__fsCache.disks) ? __fsCache.disks : [];
          if (!__fsTimer || (Date.now() - (__fsCache.ts || 0) > 60_000)) __refreshFsCache();

          const processesTop5 = Array.isArray(__procCache.top5) ? __procCache.top5 : [];
          if (!__procTimer || (Date.now() - (__procCache.ts || 0) > 20_000)) __refreshProcCache();
          
          // 获取网络接口信息（轻量）
          const networkInterfaces = os.networkInterfaces();
          const networkStats = {};
          for (const [name, interfaces] of Object.entries(networkInterfaces)) {
            if (interfaces) {
              for (const iface of interfaces) {
                if (iface.family === 'IPv4' && !iface.internal) {
                  networkStats[name] = {
                    address: iface.address,
                    netmask: iface.netmask,
                    mac: iface.mac
                  };
                }
              }
            }
          }

          // 获取进程信息
          const bots = Object.entries(Bot.bots)
            .filter(([uin, bot]) => {
              if (typeof bot !== 'object' || !bot) return false;
              const excludeKeys = ['port', 'apiKey', 'stdin', 'logger', '_eventsCount', 'url'];
              if (excludeKeys.includes(uin)) return false;
              return bot.adapter || bot.nickname || bot.fl || bot.gl;
            })
            .map(([uin, bot]) => ({
              uin,
              online: bot.stat?.online || false,
              nickname: bot.nickname || uin,
              adapter: bot.adapter?.name || 'unknown',
              device: bot.device || false,
              stats: {
                friends: bot.fl?.size || 0,
                groups: bot.gl?.size || 0
              }
            }));

          const includeHist = (req.query?.hist === '24h') || (req.query?.withHistory === '1') || (req.query?.withHistory === 'true');
          res.json({
            success: true,
            timestamp: Date.now(),
            system: {
              platform: os.platform(),
              arch: os.arch(),
              hostname: os.hostname(),
              nodeVersion: process.version,
              uptime: process.uptime(),
              cpu: {
                model: cpus[0]?.model || 'Unknown',
                cores: cpus.length,
                usage: process.cpuUsage(),
                percent: cpuPct,
                loadavg: os.loadavg ? os.loadavg() : [0,0,0]
              },
              memory: {
                total: totalMem,
                free: freeMem,
                used: usedMem,
                usagePercent: ((usedMem / totalMem) * 100).toFixed(2),
                process: {
                  rss: memUsage.rss,
                  heapTotal: memUsage.heapTotal,
                  heapUsed: memUsage.heapUsed,
                  external: memUsage.external,
                  arrayBuffers: memUsage.arrayBuffers
                }
              },
              swap: {
                total: Number(siMem?.swaptotal || 0),
                used: Number(siMem?.swapused || 0),
                usagePercent: siMem?.swaptotal ? +(((siMem.swapused || 0) / siMem.swaptotal) * 100).toFixed(2) : 0
              },
              disks,
              net: { rxBytes, txBytes },
              netRates: { rxSec, txSec },
              netHistory24h: includeHist ? __getNetHistory24h() : [],
              network: networkStats
            },
            bot: {
              url: Bot.url,
              port: Bot.port,
              startTime: Bot.stat?.start_time || Date.now() / 1000,
              uptime: Bot.stat?.start_time ? (Date.now() / 1000) - Bot.stat.start_time : process.uptime()
            },
            bots,
            processesTop5,
            adapters: Bot.adapter
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            error: error.message
          });
        }
      }
    },

    {
      method: 'GET',
      path: '/api/status',
      handler: async (req, res, Bot) => {
        const bots = Object.entries(Bot.bots)
          .filter(([uin, bot]) => {
            if (typeof bot !== 'object' || !bot) return false;
            const excludeKeys = ['port', 'apiKey', 'stdin', 'logger', '_eventsCount', 'url'];
            if (excludeKeys.includes(uin)) return false;
            return bot.adapter || bot.nickname || bot.fl || bot.gl;
          })
          .map(([uin, bot]) => ({
            uin,
            online: bot.stat?.online || false,
            nickname: bot.nickname || uin,
            adapter: bot.adapter?.name || 'unknown',
            device: bot.device || false,
            stats: {
              friends: bot.fl?.size || 0,
              groups: bot.gl?.size || 0
            }
          }));

        res.json({
          success: true,
          system: {
            platform: os.platform(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version
          },
          bot: {
            url: Bot.url,
            port: Bot.port,
            startTime: Bot.stat.start_time,
            uptime: (Date.now() / 1000) - Bot.stat.start_time
          },
          bots,
          adapters: Bot.adapter
        });
      }
    },

    {
      method: 'GET',
      path: '/api/config',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        function serialize(obj, seen = new WeakSet()) {
          if (typeof obj === 'function') {
            return obj.toString();
          }
          if (typeof obj !== 'object' || obj === null) {
            return obj;
          }
          if (seen.has(obj)) {
            return '[Circular]';
          }
          seen.add(obj);
          if (Array.isArray(obj)) {
            return obj.map(item => serialize(item, seen));
          }
          const result = {};
          for (const [key, value] of Object.entries(obj)) {
            result[key] = serialize(value, seen);
          }
          return result;
        }

        res.json({
          success: true,
          config: serialize(cfg)
        });
      }
    },

    {
      method: 'GET',
      path: '/api/health',
      handler: async (req, res, Bot) => {
        const redisOk = await redis.ping().then(() => true).catch(() => false);
        
        res.json({
          status: 'healthy',
          timestamp: Date.now(),
          services: {
            bot: Bot.uin.length > 0 ? 'operational' : 'degraded',
            redis: redisOk ? 'operational' : 'down',
            api: 'operational'
          }
        });
      }
    }
  ]
};