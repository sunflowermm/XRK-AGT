import { collectBotInventory } from '#infrastructure/http/utils/botInventory.js';
import { InputValidator } from '#utils/input-validator.js';
import { HttpResponse } from '#utils/http-utils.js';

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
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const includeDevicesRaw = String(req.query?.includeDevices ?? '').toLowerCase();
        const includeDevices = includeDevicesRaw === '1' || includeDevicesRaw === 'true' || includeDevicesRaw === 'yes';
        const bots = collectBotInventory(Bot, { includeDevices });
        const payload = includeDevices ? bots : bots.filter(b => !b.device);
        HttpResponse.success(res, { bots: payload });
      }, 'bot.list')
    },

    {
      method: 'GET',
      path: '/api/bot/:uin/friends',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const uin = InputValidator.validateUserId(req.params.uin);
        const bot = Bot.bots[uin];
        
        if (!bot) {
          return HttpResponse.notFound(res, '机器人不存在');
        }

        const friends = bot.fl ? Array.from(bot.fl.values()) : [];
        HttpResponse.success(res, { friends });
      }, 'bot.friends')
    },

    {
      method: 'GET', 
      path: '/api/bot/:uin/groups',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const uin = InputValidator.validateUserId(req.params.uin);
        const bot = Bot.bots[uin];
        
        if (!bot) {
          return HttpResponse.notFound(res, '机器人不存在');
        }

        const groups = bot.gl ? Array.from(bot.gl.values()) : [];
        HttpResponse.success(res, { groups });
      }, 'bot.groups')
    },

    {
      method: 'POST',
      path: '/api/message/send',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        // 输入验证
        const { bot_id, type, target_id, message } = req.body;

        if (!type || !target_id || !message) {
          return HttpResponse.validationError(res, '缺少必要参数');
        }

        // 验证用户ID
        if (bot_id) InputValidator.validateUserId(bot_id);
        InputValidator.validateUserId(target_id);

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
          return HttpResponse.validationError(res, '不支持的消息类型');
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

        HttpResponse.success(res, {
          message_id: sendResult?.message_id,
          results: [result],
          timestamp: Date.now()
        });
      }, 'message.send')
    },

    {
      method: 'POST',
      path: '/api/bot/:uin/control',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        // 输入验证
        const uin = InputValidator.validateUserId(req.params.uin);
        const { action } = req.body;
        
        if (!Bot.bots[uin]) {
          return HttpResponse.notFound(res, '机器人不存在');
        }

        const redis = global.redis || Bot.redis;
        if (!redis) {
          return HttpResponse.error(res, new Error('Redis未初始化'), 503, 'bot.control');
        }

        switch (action) {
          case 'shutdown':
            await redis.set(`Yz:shutdown:${uin}`, 'true');
            HttpResponse.success(res, null, '已关机');
            break;
          case 'startup':
            await redis.del(`Yz:shutdown:${uin}`);
            HttpResponse.success(res, null, '已开机');
            break;
          default:
            HttpResponse.validationError(res, '不支持的操作');
        }
      }, 'bot.control')
    }
  ]
};