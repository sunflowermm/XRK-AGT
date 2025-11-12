import os from 'os';
import cfg from '../../lib/config/config.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
      path: '/api/metrics/all',
      handler: async (req, res, Bot) => {
        try {
          const cpus = os.cpus();
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const usedMem = totalMem - freeMem;
          const memUsage = process.memoryUsage();

          const networkInterfaces = os.networkInterfaces();
          const networkStats = {};
          for (const [name, interfaces] of Object.entries(networkInterfaces)) {
            if (!interfaces) continue;
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
              stats: { friends: bot.fl?.size || 0, groups: bot.gl?.size || 0 }
            }));

          // 进程CPU采样
          const start = process.cpuUsage();
          const startTime = Date.now();
          await new Promise(r => setTimeout(r, 250));
          const diff = process.cpuUsage(start);
          const elapsedMs = Math.max(1, Date.now() - startTime);
          const cpuPercent = ((diff.user + diff.system) / 1000) / elapsedMs * 100;

          // 负载与磁盘
          const loadAvg = os.loadavg();
          async function getDisks() {
            try {
              if (process.platform === 'win32') {
                const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption');
                const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                const items = [];
                for (const line of lines.slice(1)) {
                  const parts = line.split(/\s+/).filter(Boolean);
                  if (parts.length >= 3) {
                    const caption = parts[0];
                    const free = parseInt(parts[1], 10) || 0;
                    const size = parseInt(parts[2], 10) || 0;
                    items.push({ mount: caption, total: size, free, used: Math.max(0, size - free) });
                  }
                }
                return items;
              } else {
                const { stdout } = await execAsync('df -kP');
                const lines = stdout.split(/\r?\n/).slice(1);
                const items = [];
                for (const line of lines) {
                  const parts = line.split(/\s+/).filter(Boolean);
                  if (parts.length >= 6) {
                    const total = parseInt(parts[1], 10) * 1024;
                    const used = parseInt(parts[2], 10) * 1024;
                    const avail = parseInt(parts[3], 10) * 1024;
                    const mount = parts[5];
                    items.push({ mount, total, free: avail, used });
                  }
                }
                return items;
              }
            } catch {
              return [];
            }
          }
          const disks = await getDisks();

          res.json({
            success: true,
            timestamp: Date.now(),
            system: {
              platform: os.platform(),
              arch: os.arch(),
              hostname: os.hostname(),
              nodeVersion: process.version,
              uptime: process.uptime(),
              cpu: { model: cpus[0]?.model || 'Unknown', cores: cpus.length },
              memory: { total: totalMem, free: freeMem, used: usedMem, usagePercent: totalMem ? (usedMem / totalMem) * 100 : 0 },
              network: networkStats
            },
            bot: {
              url: Bot.url,
              port: Bot.port,
              startTime: Bot.stat?.start_time || Date.now() / 1000,
              uptime: Bot.stat?.start_time ? (Date.now() / 1000) - Bot.stat.start_time : process.uptime()
            },
            bots,
            metrics: {
              system: {
                cpus: os.cpus().length,
                loadAvg,
                uptime: process.uptime(),
                memory: { total: totalMem, free: freeMem, used: usedMem, usagePercent: totalMem ? (usedMem / totalMem) * 100 : 0 },
                disks
              },
              process: { pid: process.pid, uptime: process.uptime(), versions: process.versions, memory: memUsage, cpuPercent }
            }
          });
        } catch (e) {
          res.status(500).json({ success: false, error: e.message });
        }
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