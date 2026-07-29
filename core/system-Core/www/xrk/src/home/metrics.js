/** Home 概览：数值与网络历史（对齐原 system-overview.js） */

export function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clampNumber(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function calcUsagePercent(used, total) {
  const t = toFiniteNumber(total, 0);
  if (t <= 0) return 0;
  return clampNumber((toFiniteNumber(used, 0) / t) * 100, 0, 100);
}

export function formatUptime(seconds) {
  if (!seconds || seconds === 0) return '0秒';
  const s = toFiniteNumber(seconds, 0);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = Number((s % 60).toFixed(0));
  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`);
  return parts.join('');
}

export function formatLoadTime(ms) {
  const n = Number(ms) || 0;
  return n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(2)}s`;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return `${x.toFixed(digits)} ${units[i]}`;
}

/**
 * @param {object} data overview 解包后对象
 * @returns {{ cpu: number, mem: number, disk: number, uptime: string, detail: object }}
 */
export function extractMetrics(data) {
  const system = data?.system ?? {};
  const metrics = data?.panels?.metrics ?? {};

  const cpu = clampNumber(toFiniteNumber(metrics.cpu ?? system?.cpu?.percent ?? 0, 0), 0, 100);

  const memUsed = system?.memory?.used ?? 0;
  const memTotal = system?.memory?.total ?? 1;
  const memFree = system?.memory?.free ?? Math.max(0, memTotal - memUsed);
  const mem = toFiniteNumber(metrics.memory ?? calcUsagePercent(memUsed, memTotal), 0);

  const disksRaw = Array.isArray(system?.disks) ? system.disks : [];
  let disk = 0;
  if (typeof metrics.disk === 'number') {
    disk = clampNumber(toFiniteNumber(metrics.disk, 0), 0, 100);
  } else if (disksRaw.length > 0) {
    disk = calcUsagePercent(disksRaw[0].used, disksRaw[0].size);
  }

  const uptimeSec = system?.uptime ?? data?.bot?.uptime ?? 0;
  const rxSec = Math.max(0, Number(metrics.net?.rxSec ?? system?.netRates?.rxSec ?? 0)) / 1024;
  const txSec = Math.max(0, Number(metrics.net?.txSec ?? system?.netRates?.txSec ?? 0)) / 1024;

  const disks = disksRaw.map((d, i) => {
    const size = d.size ?? d.total ?? 0;
    const used = d.used ?? 0;
    const pct = calcUsagePercent(used, size);
    return {
      id: d.mount ?? d.fs ?? d.device ?? `disk-${i}`,
      label: d.mount ?? d.fs ?? d.device ?? `磁盘 ${i + 1}`,
      used,
      size,
      pct,
      usedText: formatBytes(used),
      sizeText: formatBytes(size),
    };
  });

  const ifaces = [];
  const network = system?.network ?? {};
  for (const [name, info] of Object.entries(network)) {
    if (!info || typeof info !== 'object') continue;
    ifaces.push({
      name,
      address: info.address || '—',
      mac: info.mac || '—',
    });
  }

  const platform = system?.platform || '—';
  const loadavgRaw = system?.cpu?.loadavg;
  // win32 无 loadavg（后端发 null；旧后端可能仍发 [0,0,0]）
  const loadavg =
    Array.isArray(loadavgRaw) && platform !== 'win32'
      ? loadavgRaw.map((n) => toFiniteNumber(n, 0).toFixed(2))
      : null;
  const swapTotal = system?.swap?.total ?? 0;
  const swapUsed = system?.swap?.used ?? 0;

  let botPort = data?.bot?.port;
  if (botPort == null || botPort === '') {
    try {
      botPort = new URL(String(data?.bot?.url || ''), window.location.origin).port || null;
    } catch {
      botPort = null;
    }
  }
  if (botPort == null || botPort === '') {
    botPort = window.location.port || null;
  }

  return {
    cpu,
    mem,
    disk,
    uptime: formatUptime(uptimeSec),
    detail: {
      hostname: system?.hostname || '—',
      platform,
      arch: system?.arch || '—',
      nodeVersion: system?.nodeVersion || '—',
      cpuModel: (system?.cpu?.model || '—').trim(),
      cpuCores: system?.cpu?.cores ?? '—',
      loadavg: loadavg || ['—'],
      loadavgText: loadavg ? loadavg.join(' · ') : '不适用',
      memUsed,
      memFree,
      memTotal,
      memUsedText: formatBytes(memUsed),
      memFreeText: formatBytes(memFree),
      memTotalText: formatBytes(memTotal),
      heapUsed: formatBytes(system?.memory?.process?.heapUsed),
      rss: formatBytes(system?.memory?.process?.rss),
      swapPct: toFiniteNumber(system?.swap?.usagePercent, 0),
      swapText:
        swapTotal > 0 ? `${formatBytes(swapUsed)} / ${formatBytes(swapTotal)}` : '无交换分区',
      rxSec,
      txSec,
      rxText: `${rxSec.toFixed(1)} KB/s`,
      txText: `${txSec.toFixed(1)} KB/s`,
      disks,
      ifaces,
      botPort: botPort ?? '—',
      botUrl: data?.bot?.url || '—',
    },
  };
}

/**
 * 更新网络 KB/s 历史（原地改 history）
 * @param {{ netRx: number[], netTx: number[], _lastUpdate?: number|null }} history
 * @param {object} data
 */
export function pushNetHistory(history, data) {
  const system = data?.system ?? {};
  const metrics = data?.panels?.metrics ?? {};
  const netRecent = system?.netRecent ?? data?.network?.recent ?? [];
  const currentRxSec = Math.max(0, Number(metrics.net?.rxSec ?? system?.netRates?.rxSec ?? 0)) / 1024;
  const currentTxSec = Math.max(0, Number(metrics.net?.txSec ?? system?.netRates?.txSec ?? 0)) / 1024;

  if (netRecent.length > 0) {
    const recent = netRecent.slice(-60);
    history.netRx = recent.map((h) => Math.max(0, (h.rxSec || 0) / 1024));
    history.netTx = recent.map((h) => Math.max(0, (h.txSec || 0) / 1024));
    return;
  }

  const now = Date.now();
  if (!history._lastUpdate || now - history._lastUpdate >= 3000) {
    history.netRx.push(currentRxSec);
    history.netTx.push(currentTxSec);
    history._lastUpdate = now;
    if (history.netRx.length > 60) history.netRx.shift();
    if (history.netTx.length > 60) history.netTx.shift();
  } else if (history.netRx.length > 0) {
    history.netRx[history.netRx.length - 1] = currentRxSec;
    history.netTx[history.netTx.length - 1] = currentTxSec;
  } else {
    history.netRx = [currentRxSec];
    history.netTx = [currentTxSec];
  }
}

export function hashStr(s) {
  let h = 0;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function sizeClass(seed) {
  return ['sm', 'md', 'lg'][hashStr(seed) % 3];
}

export function toneClass(seed) {
  return ['primary', 'success', 'warning', 'info'][hashStr(seed) % 4];
}
