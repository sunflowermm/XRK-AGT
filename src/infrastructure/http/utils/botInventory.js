const EXCLUDE_KEYS = new Set(['port', 'apiKey', 'stdin', 'logger', '_eventsCount', 'url']);

async function ensureBotFlGl(bot, uin) {
  if (bot.device_type || typeof bot.getFriendMap !== 'function') return;
  const needFl = !bot.fl || bot.fl.size === 0;
  const needGl = !bot.gl || bot.gl.size === 0;
  if (!needFl && !needGl) return;
  try {
    if (needFl) await bot.getFriendMap();
  } catch {}
  try {
    if (needGl) await bot.getGroupMap();
  } catch {}
}

export async function collectBotInventory(Bot, { includeDevices = true } = {}) {
  if (!Bot?.bots) return [];
  const list = [];
  const entries = Object.entries(Bot.bots);
  for (const [uin, bot] of entries) {
    if (!bot || typeof bot !== 'object' || EXCLUDE_KEYS.has(uin)) continue;

    if (bot.device_type) {
      list.push({
        uin,
        device: true,
        online: bot.online !== false,
        nickname: bot.nickname || bot.info?.device_name || '设备',
        tasker: bot.device_type === 'web' ? 'Web客户端' : (bot.device_type || 'device'),
        stats: { friends: 0, groups: 0 }
      });
      continue;
    }

    if (!bot.tasker && !bot.nickname && !bot.fl && !bot.gl) continue;

    await ensureBotFlGl(bot, uin);

    const online = Boolean(bot.stat?.online ?? bot._ready);
    list.push({
      uin,
      device: false,
      online,
      nickname: bot.nickname || uin,
      tasker: bot.tasker?.name || 'unknown',
      avatar: bot.avatar || (bot.uin && bot.tasker?.name === 'OneBotv11' ? `https://q1.qlogo.cn/g?b=qq&nk=${bot.uin}&s=100` : null),
      stats: { friends: bot.fl?.size ?? 0, groups: bot.gl?.size ?? 0 }
    });
  }
  return list.sort((a, b) => (a.device !== b.device ? (a.device ? 1 : -1) : Number(b.online) - Number(a.online)));
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

