const EXCLUDE_KEYS = new Set([
  'port',
  'apiKey',
 'stdin',
 'logger',
 '_eventsCount',
 'url'
]);

/**
 * 汇总机器人/设备实例，输出统一结构
 * @param {Object} Bot
 * @param {Object} options
 * @param {boolean} options.includeDevices
 * @returns {Array<Object>}
 */
export function collectBotInventory(Bot, { includeDevices = true } = {}) {
  if (!Bot || typeof Bot !== 'object') {
    return [];
  }

  const merged = { ...(Bot.bots || {}) };

  if (includeDevices) {
    for (const key of Object.keys(Bot)) {
      if (merged[key]) continue;
      const candidate = Bot[key];
      if (candidate && typeof candidate === 'object' && candidate.device_type) {
        merged[key] = candidate;
      }
    }
  }

  const list = [];
  for (const [uin, bot] of Object.entries(merged)) {
    if (!bot || typeof bot !== 'object') continue;
    if (EXCLUDE_KEYS.has(uin)) continue;

    if (bot.device_type) {
      list.push({
        uin,
        device: true,
        online: bot.online !== false,
        nickname: bot.nickname || bot.info?.device_name || '设备',
        adapter: bot.device_type === 'web' ? 'Web客户端' : (bot.device_type || 'device'),
        stats: { friends: 0, groups: 0 }
      });
      continue;
    }

    if (!(bot.adapter || bot.nickname || bot.fl || bot.gl)) {
      continue;
    }

    let avatarUrl = null;
    if (bot.adapter?.name === 'OneBotv11' && bot.uin) {
      avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${bot.uin}&s=100`;
    } else if (bot.avatar) {
      avatarUrl = bot.avatar;
    }

    list.push({
      uin,
      device: false,
      online: bot.stat?.online || false,
      nickname: bot.nickname || uin,
      adapter: bot.adapter?.name || 'unknown',
      avatar: avatarUrl,
      stats: {
        friends: bot.fl?.size || 0,
        groups: bot.gl?.size || 0
      }
    });
  }

  return list.sort((a, b) => {
    if (a.device !== b.device) return a.device ? 1 : -1;
    return Number(b.online) - Number(a.online);
  });
}

/**
 * 统计机器人/设备数量
 * @param {Array<Object>} bots
 */
export function summarizeBots(bots = []) {
  const summary = {
    total: bots.length,
    devices: 0,
    online: 0,
    offline: 0
  };

  for (const bot of bots) {
    if (bot.device) summary.devices++;
    if (bot.online) summary.online++;
    else summary.offline++;
  }

  return summary;
}

