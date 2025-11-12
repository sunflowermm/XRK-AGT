import os from 'os';
import cfg from '../../lib/config/config.js';

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
          // 获取系统信息
          const cpus = os.cpus();
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const usedMem = totalMem - freeMem;
          const memUsage = process.memoryUsage();
          
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
                usage: process.cpuUsage()
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
              network: networkStats
            },
            bot: {
              url: Bot.url,
              port: Bot.port,
              startTime: Bot.stat?.start_time || Date.now() / 1000,
              uptime: Bot.stat?.start_time ? (Date.now() / 1000) - Bot.stat.start_time : process.uptime()
            },
            bots,
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