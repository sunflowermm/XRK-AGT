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

  // 统一从 Bot.bots 收集，所有子 Bot（账号 / 设备 / stdin 等）都通过 Bot 代理注册到这里
  const merged = { ...(Bot.bots || {}) };

  const list = [];
  for (const [uin, bot] of Object.entries(merged)) {
    if (!bot || typeof bot !== 'object' || EXCLUDE_KEYS.has(uin)) continue;

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

    const hasBasicInfo = bot.adapter || bot.nickname || bot.fl || bot.gl;
    if (!hasBasicInfo) continue;

    const avatarUrl = bot.avatar ||
      (bot.adapter?.name === 'OneBotv11' && bot.uin
        ? `https://q1.qlogo.cn/g?b=qq&nk=${bot.uin}&s=100`
        : null);

    list.push({
      uin,
      device: false,
      online: Boolean(bot.stat?.online),
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

