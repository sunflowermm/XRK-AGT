/**
 * 跨平台系统指标（HTTP 概览 / #状态 共用）
 * 一律走 systeminformation + os；不 shell 采数。
 */
import os from 'node:os';
import si from 'systeminformation';

const MIN_DISK_BYTES = 1 * 1024 * 1024 * 1024;
const PSEUDO_FS_RE = /^(tmpfs|overlay|devtmpfs|squashfs|ramfs|aufs|fuse\.|proc|sysfs|cgroup)/i;
const PSEUDO_MOUNT_RE = /^\/(dev|proc|sys|run|snap)(\/|$)/i;

function isRootMount(mount) {
  const m = String(mount || '');
  return m === '/' || m === 'C:\\' || /^[A-Za-z]:\\?$/.test(m);
}

/** 滤掉伪/过小卷，根分区优先，否则按容量降序 */
export function normalizeDisks(raw) {
  const list = (Array.isArray(raw) ? raw : [])
    .map((d) => {
      const size = Number(d.size || 0);
      const used = Number(d.used || 0);
      const reported = Number(d.use);
      const use =
        Number.isFinite(reported) && reported > 0
          ? reported
          : size > 0
            ? +((used / size) * 100).toFixed(2)
            : 0;
      return {
        fs: String(d.fs || d.type || d.mount || 'disk'),
        mount: String(d.mount || d.fs || ''),
        size,
        used,
        use,
      };
    })
    .filter((d) => d.size > 0);

  const useful = list.filter(
    (d) =>
      d.size >= MIN_DISK_BYTES &&
      !PSEUDO_MOUNT_RE.test(d.mount) &&
      !PSEUDO_FS_RE.test(d.fs)
  );
  const pool = useful.length ? useful : list;
  pool.sort((a, b) => {
    if (isRootMount(a.mount) !== isRootMount(b.mount)) return isRootMount(a.mount) ? -1 : 1;
    return b.size - a.size;
  });
  return pool;
}

export async function readDisks() {
  return normalizeDisks(await si.fsSize().catch(() => []));
}

/**
 * 内存：优先 available（Linux/mac 准确「可用」），否则 free
 */
export async function readMem() {
  const m = await si.mem().catch(() => null);
  if (m?.total > 0) {
    const total = Number(m.total);
    const available = Number(m.available > 0 ? m.available : m.free || 0);
    const used = Math.max(0, Math.min(total, total - available));
    return {
      total,
      used,
      free: available,
      swapTotal: Number(m.swaptotal || 0),
      swapUsed: Number(m.swapused || 0),
    };
  }
  const total = os.totalmem();
  const free = os.freemem();
  return { total, used: Math.max(0, total - free), free, swapTotal: 0, swapUsed: 0 };
}

/** 累加各网卡字节；跳过回环与明显虚拟口，避免 Windows vEthernet / docker 双计 */
export function sumNetworkBytes(stats, skipIfaces) {
  const skip = skipIfaces instanceof Set ? skipIfaces : null;
  let rx = 0;
  let tx = 0;
  for (const n of Array.isArray(stats) ? stats : []) {
    const iface = String(n.iface || n.interface || '');
    if (!iface) continue;
    if (skip?.has(iface)) continue;
    if (/^lo\d*$/i.test(iface) || /loopback/i.test(iface)) continue;
    if (/^(veth|br-|docker|virbr|tun|tap|wg|isatap|teredo)/i.test(iface)) continue;
    if (/^vEthernet/i.test(iface)) continue;
    rx += Number(n.rx_bytes || n.bytes_recv || 0);
    tx += Number(n.tx_bytes || n.bytes_sent || 0);
  }
  return { rx, tx };
}

export async function readNetworkBytes() {
  const [stats, ifaces] = await Promise.all([
    si.networkStats('*').catch(() => si.networkStats().catch(() => [])),
    si.networkInterfaces().catch(() => []),
  ]);
  const skip = new Set();
  for (const i of Array.isArray(ifaces) ? ifaces : []) {
    if (i?.virtual || i?.internal) skip.add(String(i.iface || ''));
  }
  return sumNetworkBytes(stats, skip);
}

/** 一次性 CPU 占用（#状态等） */
export async function readCpuLoadPercent() {
  const load = await si.currentLoad().catch(() => null);
  if (load && Number.isFinite(load.currentLoad)) return +Number(load.currentLoad).toFixed(2);
  const cpus = load?.cpus;
  if (Array.isArray(cpus) && cpus.length) {
    const avg = cpus.reduce((s, c) => s + Number(c.load || 0), 0) / cpus.length;
    return +avg.toFixed(2);
  }
  return 0;
}
