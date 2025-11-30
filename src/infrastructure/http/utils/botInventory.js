const EXCLUDE_KEYS = new Set([
  'port',
  'apiKey',
  'stdin',
  'logger',
  '_eventsCount',
  'url'
]);

export function collectBotInventory(Bot, { includeDevices = true } = {}) {
  if (!Bot || typeof Bot !== 'object') {
    return [];
  }

  const merged = new Map();
  
  // 首先收集 Bot.bots 中的机器人
  if (Bot.bots && typeof Bot.bots === 'object') {
    for (const [uin, bot] of Object.entries(Bot.bots)) {
      if (bot && typeof bot === 'object' && !EXCLUDE_KEYS.has(uin)) {
        merged.set(uin, bot);
      }
    }
  }

  // 然后收集设备（包括网页注册的设备）
  if (includeDevices) {
    for (const key of Object.keys(Bot)) {
      if (EXCLUDE_KEYS.has(key)) continue;
      if (merged.has(key)) continue;
      
      const candidate = Bot[key];
      if (candidate && typeof candidate === 'object' && candidate.device_type) {
        merged.set(key, candidate);
      }
    }
  }

  const list = [];
  for (const [uin, bot] of merged.entries()) {
    if (!bot || typeof bot !== 'object') continue;

    // 处理设备
    if (bot.device_type) {
      list.push({
        uin,
        device: true,
        online: bot.online !== false,
        nickname: bot.nickname || bot.info?.device_name || bot.device_name || '设备',
        adapter: bot.device_type === 'web' ? 'Web客户端' : (bot.device_type || 'device'),
        stats: { friends: 0, groups: 0 }
      });
      continue;
    }

    // 处理普通机器人
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
      online: bot.stat?.online !== false,
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

