/**
 * 机器人管理API
 * 提供机器人状态查询、消息发送、好友群组列表等功能
 */
export default {
  name: 'bot',
  dsc: '机器人管理与消息API',
  priority: 100,

  routes: [
    {
      method: 'GET',
      path: '/api/bots',
      handler: async (req, res, Bot) => {
        const bots = Object.entries(Bot.bots)
          .filter(([uin, bot]) => {
            if (typeof bot !== 'object' || !bot) return false;
            const excludeKeys = ['port', 'apiKey', 'stdin', 'logger', '_eventsCount', 'url'];
            if (excludeKeys.includes(uin)) return false;
            if (bot.device) return false;
            return bot.adapter || bot.nickname || bot.fl || bot.gl;
          })
          .map(([uin, bot]) => ({
            uin,
            online: bot.stat?.online || false,
            nickname: bot.nickname || uin,
            adapter: bot.adapter?.name || 'unknown',
            friends: bot.fl?.size || 0,
            groups: bot.gl?.size || 0
          }));

        res.json({ success: true, bots });
      }
    },

    {
      method: 'GET',
      path: '/api/bot/:uin/friends',
      handler: async (req, res, Bot) => {
        const { uin } = req.params;
        const bot = Bot.bots[uin];
        
        if (!bot) {
          return res.status(404).json({ success: false, message: '机器人不存在' });
        }

        const friends = bot.fl ? Array.from(bot.fl.values()) : [];
        res.json({ success: true, friends });
      }
    },

    {
      method: 'GET', 
      path: '/api/bot/:uin/groups',
      handler: async (req, res, Bot) => {
        const { uin } = req.params;
        const bot = Bot.bots[uin];
        
        if (!bot) {
          return res.status(404).json({ success: false, message: '机器人不存在' });
        }

        const groups = bot.gl ? Array.from(bot.gl.values()) : [];
        res.json({ success: true, groups });
      }
    },

    {
      method: 'POST',
      path: '/api/message/send',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { bot_id, type, target_id, message } = req.body;

        if (!type || !target_id || !message) {
          return res.status(400).json({ 
            success: false, 
            message: '缺少必要参数' 
          });
        }

        try {
          let processedMessage = message;
          if (typeof message === 'string') {
            try {
              const parsed = JSON.parse(message);
              if (Array.isArray(parsed)) {
                processedMessage = parsed;
              }
            } catch (e) {
              processedMessage = message;
            }
          }

          // 发送消息
          let sendResult;
          if (type === 'private' || type === 'friend') {
            if (bot_id) {
              sendResult = await Bot.sendFriendMsg(bot_id, target_id, processedMessage);
            } else {
              sendResult = await Bot.pickFriend(target_id).sendMsg(processedMessage);
            }
          } else if (type === 'group') {
            if (bot_id) {
              sendResult = await Bot.sendGroupMsg(bot_id, target_id, processedMessage);
            } else {
              sendResult = await Bot.pickGroup(target_id).sendMsg(processedMessage);
            }
          } else {
            return res.status(400).json({ 
              success: false, 
              message: '不支持的消息类型' 
            });
          }

          const result = {
            message_id: sendResult?.message_id,
            time: Date.now() / 1000,
            raw_message: processedMessage
          };

          Bot.em('message.send', {
            bot_id: bot_id ? bot_id : Bot.uin[0],
            type,
            target_id,
            message: processedMessage,
            message_id: sendResult?.message_id,
            time: Math.floor(Date.now() / 1000)
          });

          res.json({ 
            success: true, 
            message_id: sendResult?.message_id,
            results: [result],
            timestamp: Date.now()
          });
        } catch (error) {
          res.status(500).json({ 
            success: false, 
            message: '发送失败',
            error: error.message 
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/bot/:uin/control',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { uin } = req.params;
        const { action } = req.body;
        
        if (!Bot.bots[uin]) {
          return res.status(404).json({ success: false, message: '机器人不存在' });
        }

        try {
          switch (action) {
            case 'shutdown':
              await redis.set(`Yz:shutdown:${uin}`, 'true');
              res.json({ success: true, message: '已关机' });
              break;
            case 'startup':
              await redis.del(`Yz:shutdown:${uin}`);
              res.json({ success: true, message: '已开机' });
              break;
            default:
              res.status(400).json({ success: false, message: '不支持的操作' });
          }
        } catch (error) {
          res.status(500).json({ 
            success: false, 
            message: '操作失败',
            error: error.message 
          });
        }
      }
    }
  ],

  // WebSocket处理器
  ws: {
    messages: [(conn, req, Bot) => {
      const messageListener = (data) => {
        conn.sendMsg(JSON.stringify({
          type: 'message',
          data,
          timestamp: Date.now()
        }));
      };

      const sendListener = (data) => {
        conn.sendMsg(JSON.stringify({
          type: 'message.send',
          data,
          timestamp: Date.now()
        }));
      };

      Bot.on('message', messageListener);
      Bot.on('message.send', sendListener);

      conn.on('close', () => {
        Bot.off('message', messageListener);
        Bot.off('message.send', sendListener);
      });
    }]
  },
};