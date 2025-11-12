import os from 'os';
import si from 'systeminformation';
import cfg from '../../lib/config/config.js';
let __lastNetSample = null;

/**
 * 核心系统API
 * 提供系统状态、配置查询、健康检查等基础功能
 */
export default {
  name: 'core',
  dsc: '核心系统API',
  priority: 200,

  routes: [
    {
      method: 'GET',
      path: '/api/system/status',
      handler: async (req, res, Bot) => {
        try {
          const q = (req && (req.query || req.searchParams)) || {};
          const quick = q.quick === '1' || q.lite === '1';
          // 优先用 systeminformation 获取 CPU 负载，避免等待
          let cpuPct = null;
          try {
            const load = await si.currentLoad();
            if (load && typeof load.currentload === 'number') {
              cpuPct = +load.currentload.toFixed(2);
            }
          } catch {}
          if (cpuPct === null) {
            const snap1 = os.cpus();
            await new Promise(r => setTimeout(r, 120));
            const snap2 = os.cpus();
            function cpuPercent(s1, s2) {
              if (!s1 || !s2 || s1.length !== s2.length) return null;
              let idle = 0, total = 0;
              for (let i = 0; i < s1.length; i++) {
                const t1 = s1[i].times, t2 = s2[i].times;
                const id = Math.max(0, t2.idle - t1.idle);
                const tot = Math.max(0, (t2.user - t1.user) + (t2.nice - t1.nice) + (t2.sys - t1.sys) + (t2.irq - t1.irq) + id);
                idle += id; total += tot;
              }
              if (total <= 0) return null;
              return +(((total - idle) / total) * 100).toFixed(2);
            }
            cpuPct = cpuPercent(snap1, snap2);
          }

          // 获取系统信息（基础 + 详细）
          const cpus = os.cpus();
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const usedMem = totalMem - freeMem;
          const memUsage = process.memoryUsage();
          // systeminformation 提供跨平台详细信息（超时保护，避免首屏等待过久）
          const withTimeout = (p, ms, fb) => Promise.race([p, new Promise(r => setTimeout(() => r(fb), ms))]);
          const [siMem, fsSize, procs, netStats] = await Promise.all([
            withTimeout(si.mem().catch(() => ({})), 300, {}),
            withTimeout(quick ? Promise.resolve([]) : si.fsSize().catch(() => []), quick ? 1 : 1200, []),
            withTimeout(quick ? Promise.resolve({ list: [] }) : si.processes().catch(() => ({ list: [] })), quick ? 1 : 1500, { list: [] }),
            withTimeout(si.networkStats().catch(() => []), 400, [])
          ]);
          // 累计网络字节（总和）与瞬时速率
          let rxBytes = 0, txBytes = 0, rxSec = 0, txSec = 0;
          if (Array.isArray(netStats)) {
            for (const n of netStats) {
              rxBytes += Number(n.rx_bytes || 0);
              txBytes += Number(n.tx_bytes || 0);
              rxSec += Number(n.rx_sec || 0);
              txSec += Number(n.tx_sec || 0);
            }
          }
          // 无需额外等待：用上次采样差值估算速率
          const nowTs = Date.now();
          if (__lastNetSample) {
            const dt = Math.max(1, (nowTs - __lastNetSample.ts) / 1000);
            rxSec = Math.max(0, (rxBytes - __lastNetSample.rx) / dt);
            txSec = Math.max(0, (txBytes - __lastNetSample.tx) / dt);
          }
          __lastNetSample = { ts: nowTs, rx: rxBytes, tx: txBytes };
          // 磁盘列表
          const disks = Array.isArray(fsSize) ? fsSize.map(d => ({
            fs: d.fs || d.mount || d.type || 'disk',
            mount: d.mount || d.fs || '',
            size: Number(d.size || 0),
            used: Number(d.used || 0),
            use: Number(d.use || 0)
          })) : [];
          // 进程Top5（按CPU，其次内存）
          let processesTop5 = [];
          try {
            const list = procs?.list || [];
            processesTop5 = list
              .map(p => ({ pid: p.pid, name: p.name, cpu: Number(p.pcpu || p.cpu || 0), mem: Number(p.pmem || p.mem || 0) }))
              .sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
              .slice(0, 5);
          } catch {}
          
          // 获取网络接口信息
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