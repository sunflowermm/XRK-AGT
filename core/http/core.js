import os from 'os';
import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import cfg from '../../src/infrastructure/config/config.js';
import StreamLoader from '../../src/infrastructure/aistream/loader.js';
import { collectBotInventory, summarizeBots } from '../../src/infrastructure/http/utils/botInventory.js';
import BotUtil from '#utils/botutil.js';
import { HttpResponse } from '../../src/utils/http-utils.js';

const execAsync = promisify(exec);

let __lastNetSample = null;
let __netSampler = null;
let __netHist = []; // 长期历史（按分钟）
let __netRecent = []; // 近期数据（每3-5秒一个点，用于图表显示）
const NET_HISTORY_LIMIT = 24 * 60; // 24小时，每分钟一个点
const NET_RECENT_LIMIT = 60; // 最近60个点，用于实时图表
const NET_SAMPLE_MS = 3_000; // 每3秒采样一次
let __netMethod = 'auto'; // 当前使用的网络采样方法
let __netMethodValidated = false; // 是否已验证方法有效性

// CPU 采样缓存（单一方法：os.cpus 快照法）
let __cpuCache = { percent: 0, ts: 0 };
let __cpuTimer = null;
let __cpuPrevSnap = null;
function __sampleCpuOnce() {
  try {
    const cpus = os.cpus();
    if (!cpus || cpus.length === 0) return;
    if (!__cpuPrevSnap) { __cpuPrevSnap = cpus; return; }
    let idleDelta = 0, totalDelta = 0;
    for (let i = 0; i < cpus.length; i++) {
      const t1 = __cpuPrevSnap[i].times, t2 = cpus[i].times;
      const idle = Math.max(0, t2.idle - t1.idle);
      const total = Math.max(0,
        (t2.user - t1.user) + (t2.nice - t1.nice) + (t2.sys - t1.sys) + (t2.irq - t1.irq) + idle
      );
      idleDelta += idle; totalDelta += total;
    }
    __cpuPrevSnap = cpus;
    if (totalDelta > 0) {
      const usedPct = +(((totalDelta - idleDelta) / totalDelta) * 100).toFixed(2);
      __cpuCache = { percent: usedPct, ts: Date.now() };
    }
  } catch {}
}

let __fsCache = { disks: [], ts: 0 };
let __procCache = { top5: [], ts: 0 };
let __fsTimer = null;
let __procTimer = null;

/**
 * Windows网络流量采样（优化版，Windows Server优先使用累计值方法）
 */
async function __sampleNetWindows() {
  let lastError = null;
  
  // 方法1: 使用Get-NetAdapterStatistics（PowerShell，累计值，Windows Server最准确）
  try {
    const { stdout, stderr } = await execAsync(
      'powershell -NoProfile -Command "$adapters = Get-NetAdapterStatistics | Where-Object { $_.InterfaceDescription -notlike \"*Loopback*\" -and $_.InterfaceDescription -notlike \"*Teredo*\" -and $_.InterfaceDescription -notlike \"*isatap*\" -and $_.InterfaceDescription -notlike \"*Virtual*\" }; if ($adapters) { $rx = ($adapters | Measure-Object -Property ReceivedBytes -Sum).Sum; $tx = ($adapters | Measure-Object -Property SentBytes -Sum).Sum; \"$rx|$tx\" } else { \"0|0\" }"',
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    );
    const parts = stdout.trim().split('|');
    if (parts.length === 2) {
      const rxBytes = parseFloat(parts[0]) || 0;
      const txBytes = parseFloat(parts[1]) || 0;
      // 返回结果，即使为0也返回（可能是真实值）
      return { rxBytes, txBytes, method: 'Get-NetAdapterStatistics' };
    } else {
      lastError = `Get-NetAdapterStatistics输出格式错误: ${stdout.substring(0, 100)}`;
    }
  } catch (e) {
    lastError = `Get-NetAdapterStatistics失败: ${e.message}`;
  }

  // 方法2: 使用Get-Counter（PowerShell，速率值，需要转换为累计值）
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "$r = Get-Counter \"\\Network Interface(*)\\Bytes Received/sec\", \"\\Network Interface(*)\\Bytes Sent/sec\" -ErrorAction SilentlyContinue; if ($r) { $rx = 0; $tx = 0; $r.CounterSamples | ForEach-Object { if ($_.Path -match \"Bytes Received\" -and $_.Path -notmatch \"Loopback|Teredo|isatap\") { $rx += $_.CookedValue } elseif ($_.Path -match \"Bytes Sent\" -and $_.Path -notmatch \"Loopback|Teredo|isatap\") { $tx += $_.CookedValue } }; \"$rx|$tx\" } else { \"0|0\" }"',
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    );
    const parts = stdout.trim().split('|');
    if (parts.length === 2) {
      const rxRate = parseFloat(parts[0]) || 0;
      const txRate = parseFloat(parts[1]) || 0;
      // 返回速率值，后续会转换为累计值
      return { rxRate, txRate, method: 'Get-Counter' };
    } else {
      lastError = `Get-Counter输出格式错误: ${stdout.substring(0, 100)}`;
    }
  } catch (e) {
    lastError = `Get-Counter失败: ${e.message}`;
  }

  // 方法3: 使用wmic（Windows Management Instrumentation，兼容性最好）
  try {
    const { stdout } = await execAsync(
      'wmic path Win32_PerfRawData_Tcpip_NetworkInterface get BytesReceivedPersec,BytesSentPersec /format:list 2>nul',
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    );
    if (stdout && stdout.trim().length > 0) {
      let rxRate = 0, txRate = 0;
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes('BytesReceivedPersec=')) {
          const val = parseFloat(line.split('=')[1]) || 0;
          if (!isNaN(val)) rxRate += val;
        } else if (line.includes('BytesSentPersec=')) {
          const val = parseFloat(line.split('=')[1]) || 0;
          if (!isNaN(val)) txRate += val;
        }
      }
      // 即使为0也返回（可能是真实值）
      return { rxRate, txRate, method: 'wmic' };
    }
  } catch (e) {
    lastError = `wmic失败: ${e.message}`;
  }
  
  return null;
}

/**
 * Linux/macOS网络流量采样
 */
async function __sampleNetUnix() {
  try {
    const platform = process.platform;
    
    if (platform === 'linux') {
      // Linux: 读取/proc/net/dev（最快最准确）
      try {
        const { stdout } = await execAsync(
          'cat /proc/net/dev | grep -v "lo:" | awk \'BEGIN {rx=0; tx=0} {if(NR>2 && $1!="") {rx+=$2; tx+=$10}}\' END \'{print rx"|"tx}\'',
          { timeout: 1000 }
        );
        const parts = stdout.trim().split('|');
        if (parts.length === 2) {
          const rxBytes = parseInt(parts[0]) || 0;
          const txBytes = parseInt(parts[1]) || 0;
          if (rxBytes > 0 || txBytes > 0) {
            return { rxBytes, txBytes, method: '/proc/net/dev' };
          }
        }
      } catch (e) {
        // 降级方案
      }
    } else if (platform === 'darwin') {
      // macOS: 使用netstat -ib
      try {
        const { stdout } = await execAsync(
          'netstat -ib | awk \'BEGIN {rx=0; tx=0} /^[^I]/ {if($1!="Name" && $1!="") {rx+=$7; tx+=$10}}\' END \'{print rx"|"tx}\'',
          { timeout: 2000 }
        );
        const parts = stdout.trim().split('|');
        if (parts.length === 2) {
          const rxBytes = parseInt(parts[0]) || 0;
          const txBytes = parseInt(parts[1]) || 0;
          if (rxBytes > 0 || txBytes > 0) {
            return { rxBytes, txBytes, method: 'netstat -ib' };
          }
        }
      } catch (e) {
        // 降级方案
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 网络流量采样（优化版，支持多方法fallback）
 */
async function __sampleNetOnce() {
  try {
    const platform = process.platform;
    const now = Date.now();
    let rxBytes = 0, txBytes = 0;
    let rxRate = 0, txRate = 0;
    let method = 'systeminformation';
    let isValid = false;

    // 优先使用systeminformation（第三方库，跨平台，最准确）
    try {
      const stats = await si.networkStats().catch(() => []);
      
      if (Array.isArray(stats) && stats.length > 0) {
        let totalRx = 0, totalTx = 0;
        for (const n of stats) {
          const rx = Number(n.rx_bytes || n.bytes_recv || 0);
          const tx = Number(n.tx_bytes || n.bytes_sent || 0);
          totalRx += rx;
          totalTx += tx;
        }
        
        // 验证数据有效性
        if (totalRx > 0 || totalTx > 0) {
          // 检查是否是累计值（应该大于上次的值或接近，允许10%的误差）
          if (!__lastNetSample || totalRx >= __lastNetSample.rx * 0.9 || totalTx >= __lastNetSample.tx * 0.9) {
            rxBytes = totalRx;
            txBytes = totalTx;
            method = 'systeminformation';
            isValid = true;
          } else {
            // 数据异常（可能是计数器重置），但在Windows Server上仍然尝试原生方法
            if (platform === 'win32') {
              isValid = false;
            } else {
              // 其他平台，接受数据
              rxBytes = totalRx;
              txBytes = totalTx;
              method = 'systeminformation';
              isValid = true;
            }
          }
        } else {
          // systeminformation返回0
          // 在Windows Server上，如果systeminformation返回0，尝试原生方法
          // 其他平台，可能是真的没有流量，接受0值
          if (platform === 'win32') {
            isValid = false; // Windows Server上尝试原生方法
          } else {
            // 其他平台，接受0值（可能是真的没有流量）
            rxBytes = 0;
            txBytes = 0;
            method = 'systeminformation';
            isValid = true;
          }
        }
      } else {
        // systeminformation返回空数组
        if (platform === 'win32') {
          isValid = false; // Windows Server上尝试原生方法
        } else {
          // 其他平台，可能是真的没有网络接口
          rxBytes = 0;
          txBytes = 0;
          method = 'systeminformation';
          isValid = true;
        }
      }
    } catch (e) {
      // systeminformation失败，使用原生方法作为降级方案
      isValid = false;
    }

    // 如果systeminformation无效（失败或返回0且是Windows Server），使用平台原生方法作为降级方案
    if (!isValid) {
      let nativeResult = null;
      
      if (platform === 'win32') {
        nativeResult = await __sampleNetWindows();
        if (nativeResult) {
          if (nativeResult.rxBytes !== undefined) {
            // 累计值（优先使用）
            rxBytes = nativeResult.rxBytes;
            txBytes = nativeResult.txBytes;
            method = nativeResult.method;
            isValid = true;
            
          } else if (nativeResult.rxRate !== undefined) {
            // 速率值，转换为累计值
            if (__lastNetSample) {
              const dt = Math.max(0.1, (now - __lastNetSample.ts) / 1000);
              rxBytes = __lastNetSample.rx + (nativeResult.rxRate * dt);
              txBytes = __lastNetSample.tx + (nativeResult.txRate * dt);
            } else {
              // 首次采样，使用当前速率估算初始累计值
              rxBytes = nativeResult.rxRate * 60;
              txBytes = nativeResult.txRate * 60;
            }
            method = nativeResult.method;
            isValid = true;
            
          }
        } else {
          // 原生方法也失败，尝试最后的fallback
          if (!__netMethodValidated) {
            // 最后的fallback：尝试使用systeminformation的原始数据，即使为0也接受
            try {
              const stats = await si.networkStats().catch(() => []);
              if (Array.isArray(stats) && stats.length > 0) {
                let totalRx = 0, totalTx = 0;
                for (const n of stats) {
                  totalRx += Number(n.rx_bytes || n.bytes_recv || 0);
                  totalTx += Number(n.tx_bytes || n.bytes_sent || 0);
                }
                // 即使为0也接受，作为初始值（可能是真的没有流量）
                rxBytes = totalRx;
                txBytes = totalTx;
                method = 'systeminformation-fallback';
                isValid = true;
              }
            } catch (e) {
              // 忽略错误，继续使用fallback逻辑
            }
          }
        }
      } else {
        nativeResult = await __sampleNetUnix();
        if (nativeResult) {
          rxBytes = nativeResult.rxBytes;
          txBytes = nativeResult.txBytes;
          method = nativeResult.method;
          isValid = true;
        }
      }
    }

    // 如果所有方法都失败，使用上次的值（避免图表变平）
    if (!isValid) {
      if (__lastNetSample) {
        rxBytes = __lastNetSample.rx;
        txBytes = __lastNetSample.tx;
        method = 'fallback';
        isValid = true; // 使用上次值也算有效
      } else {
        // 首次采样，使用0
        rxBytes = 0;
        txBytes = 0;
        method = 'initial';
        isValid = true; // 首次采样也算有效
      }
    }

    // 记录方法有效性
    if (!__netMethodValidated && isValid && method !== 'fallback' && method !== 'initial') {
      __netMethod = method;
      __netMethodValidated = true;
    }

    const tsMin = Math.floor(now / 60000) * 60000;
    let rxSec = 0, txSec = 0;
    
    if (__lastNetSample && isValid) {
      const dt = Math.max(0.1, (now - __lastNetSample.ts) / 1000); // 最小0.1秒
      const rxDelta = rxBytes - __lastNetSample.rx;
      const txDelta = txBytes - __lastNetSample.tx;
      
      // 计算速率（bytes/s），处理计数器重置的情况
      if (rxDelta >= 0) {
        rxSec = rxDelta / dt;
      } else {
        // 计数器重置，使用上次速率
        rxSec = __netRecent.length > 0 ? __netRecent[__netRecent.length - 1].rxSec : 0;
      }
      
      if (txDelta >= 0) {
        txSec = txDelta / dt;
      } else {
        // 计数器重置，使用上次速率
        txSec = __netRecent.length > 0 ? __netRecent[__netRecent.length - 1].txSec : 0;
      }
      
      // 数据验证：如果速率异常大（可能是计数器重置），使用平滑处理
      const maxRate = 10 * 1024 * 1024 * 1024; // 10GB/s上限
      if (rxSec > maxRate || txSec > maxRate) {
        rxSec = __netRecent.length > 0 ? __netRecent[__netRecent.length - 1].rxSec : 0;
        txSec = __netRecent.length > 0 ? __netRecent[__netRecent.length - 1].txSec : 0;
      }
      
      // 添加到近期数据（用于实时图表显示）
      __netRecent.push({ ts: now, rxSec, txSec });
      if (__netRecent.length > NET_RECENT_LIMIT) {
        __netRecent.shift();
      }
      
      // 更新或添加当前分钟的数据点（用于长期历史）
      // 只有当速率大于0时才添加到历史，避免大量0值
      if (rxSec > 0 || txSec > 0) {
        if (__netHist.length && __netHist[__netHist.length - 1].ts === tsMin) {
          // 更新当前分钟的数据（取最大值，显示峰值）
          const last = __netHist[__netHist.length - 1];
          __netHist[__netHist.length - 1] = { 
            ts: tsMin, 
            rxSec: Math.max(last.rxSec, rxSec), 
            txSec: Math.max(last.txSec, txSec) 
          };
        } else {
          // 添加新分钟的数据点
          __netHist.push({ ts: tsMin, rxSec, txSec });
          if (__netHist.length > NET_HISTORY_LIMIT) __netHist.shift();
        }
      }
    }
    
    __lastNetSample = { ts: now, rx: rxBytes, tx: txBytes };
  } catch (error) {
    // 静默处理错误
  }
}

function __ensureNetSampler() {
  if (__netSampler) return;
  
  // 预热三次，确保数据准确（Windows Server需要更多预热）
  (async () => {
    await __sampleNetOnce();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await __sampleNetOnce();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await __sampleNetOnce();
  })();
  
  __netSampler = setInterval(__sampleNetOnce, NET_SAMPLE_MS);
}

function __getNetHistory24h() {
  const now = Date.now();
  const start = Math.floor((now - 24 * 60 * 60 * 1000) / 60000) * 60000;
  
  // 如果没有历史数据，返回空数组
  if (__netHist.length === 0) {
    return [];
  }
  
  // 返回最近24小时的数据（只包含有数据的点）
  const recent24h = __netHist.filter(p => p.ts >= start);
  
  // 如果24小时内没有数据，返回最近的数据点（最多返回最近1小时的数据）
  if (recent24h.length === 0) {
    const oneHourAgo = now - 60 * 60 * 1000;
    const recent = __netHist.filter(p => p.ts >= oneHourAgo);
    return recent.length > 0 ? recent : [];
  }
  
  // 如果数据点太多（超过1440个，即24小时每分钟一个点），只返回最近的数据
  if (recent24h.length > 1440) {
    return recent24h.slice(-1440);
  }
  
  return recent24h;
}

function __getNetRecent() {
  // 返回最近的数据点（用于实时图表显示）
  // 如果近期数据不足，用当前速率填充
  const recent = [...__netRecent];
  const lastHist = __netRecent.length > 0 ? __netRecent[__netRecent.length - 1] : null;
  
  // 如果数据不足，用最后一个值填充（确保图表连续性）
  if (recent.length < NET_RECENT_LIMIT) {
    const now = Date.now();
    const lastRx = lastHist?.rxSec || 0;
    const lastTx = lastHist?.txSec || 0;
    
    while (recent.length < NET_RECENT_LIMIT) {
      const idx = recent.length;
      recent.push({ 
        ts: now - (NET_RECENT_LIMIT - idx) * NET_SAMPLE_MS, 
        rxSec: lastRx, 
        txSec: lastTx 
      });
    }
  }
  
  // 确保数据按时间排序
  recent.sort((a, b) => a.ts - b.ts);
  
  return recent.slice(-NET_RECENT_LIMIT);
}

async function __refreshFsCache() {
  try {
    const fsSize = await si.fsSize().catch(() => []);
    const disks = Array.isArray(fsSize) ? fsSize.map(d => ({
      fs: d.fs || d.mount || d.type || 'disk',
      mount: d.mount || d.fs || '',
      size: Number(d.size || 0),
      used: Number(d.used || 0),
      use: Number(d.use || 0)
    })) : [];
    __fsCache = { disks, ts: Date.now() };
  } catch {}
}

async function __refreshProcCache() {
  try {
    const procs = await si.processes().catch(() => ({ list: [] }));
    const list = procs?.list || [];
    // 计算Top5（按CPU，其次内存）
    const top5 = list
      .map(p => ({ pid: p.pid, name: p.name, cpu: Number(p.pcpu || p.cpu || 0), mem: Number(p.pmem || p.mem || 0) }))
      .sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
      .slice(0, 5);
    __procCache = { top5, ts: Date.now() };
  } catch {}
}

function __ensureSysSamplers() {
  if (!__fsTimer) {
    __refreshFsCache();
    __fsTimer = setInterval(__refreshFsCache, 30_000);
  }
  if (!__procTimer) {
    __refreshProcCache();
    __procTimer = setInterval(__refreshProcCache, 10_000);
  }
  if (!__cpuTimer) {
    __cpuPrevSnap = os.cpus();
    setTimeout(__sampleCpuOnce, 600); // 预热一次，避免首次为0
    __cpuTimer = setInterval(__sampleCpuOnce, 2_000);
  }
}

async function buildSystemSnapshot(Bot, { includeHistory = false } = {}) {
          if (!__cpuCache.ts || (Date.now() - __cpuCache.ts > 5_000)) {
            __sampleCpuOnce();
          }

          const cpus = os.cpus();
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const usedMem = totalMem - freeMem;
          const memUsage = process.memoryUsage();
          const siMem = await si.mem().catch(() => ({}));

          const lastNet = __lastNetSample || { ts: Date.now(), rx: 0, tx: 0 };
          const rxBytes = Number(lastNet.rx || 0);
          const txBytes = Number(lastNet.tx || 0);
          
          // 优先使用最近的数据点，如果没有则使用历史数据
          // 使用最近3个点的平均值，提高数据稳定性
          let rxSec = 0, txSec = 0;
          if (__netRecent.length > 0) {
            const recent = __netRecent.slice(-3); // 最近3个点
            rxSec = recent.reduce((sum, p) => sum + (p.rxSec || 0), 0) / recent.length;
            txSec = recent.reduce((sum, p) => sum + (p.txSec || 0), 0) / recent.length;
          } else if (__netHist.length > 0) {
            const lastHist = __netHist[__netHist.length - 1];
            rxSec = Number(lastHist.rxSec || 0);
            txSec = Number(lastHist.txSec || 0);
          }
          
          // 数据验证：确保不为NaN或Infinity
          rxSec = isFinite(rxSec) ? rxSec : 0;
          txSec = isFinite(txSec) ? txSec : 0;

          const disks = Array.isArray(__fsCache.disks) ? __fsCache.disks : [];
          if (!__fsTimer || (Date.now() - (__fsCache.ts || 0) > 60_000)) __refreshFsCache();

          const processesTop5 = Array.isArray(__procCache.top5) ? __procCache.top5 : [];
          if (!__procTimer || (Date.now() - (__procCache.ts || 0) > 20_000)) __refreshProcCache();
          
  const networkStats = {};
  const networkInterfaces = os.networkInterfaces();
  for (const [name, interfaces] of Object.entries(networkInterfaces)) {
    if (!Array.isArray(interfaces)) continue;
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        networkStats[name] = {
          address: iface.address,
          netmask: iface.netmask,
          mac: iface.mac
        };
        break;
      }
    }
  }

  const bots = collectBotInventory(Bot, { includeDevices: true });
  const workflowStats = StreamLoader.getStats();
  const workflowList = StreamLoader.getStreamsByPriority().map(stream => ({
    name: stream.name,
    description: stream.description,
    priority: stream.priority,
    enabled: stream.config?.enabled !== false,
    embeddingReady: !!stream.embeddingReady
  }));

  const system = {
              platform: os.platform(),
              arch: os.arch(),
              hostname: os.hostname(),
              nodeVersion: process.version,
              uptime: process.uptime(),
              cpu: {
                model: cpus[0]?.model || 'Unknown',
                cores: cpus.length,
                usage: process.cpuUsage(),
      percent: __cpuCache.percent || 0,
      loadavg: os.loadavg ? os.loadavg() : [0, 0, 0]
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
              swap: {
                total: Number(siMem?.swaptotal || 0),
                used: Number(siMem?.swapused || 0),
                usagePercent: siMem?.swaptotal ? +(((siMem.swapused || 0) / siMem.swaptotal) * 100).toFixed(2) : 0
              },
              disks,
              net: { rxBytes, txBytes },
              netRates: { rxSec, txSec },
              netHistory24h: includeHistory ? __getNetHistory24h() : [],
              netRecent: __getNetRecent(), // 返回最近的数据点用于实时图表
              network: networkStats
  };

  const snapshot = {
    success: true,
    timestamp: Date.now(),
    system,
            bot: {
              url: Bot.url,
              port: Bot.port,
              startTime: Bot.stat?.start_time || Date.now() / 1000,
              uptime: Bot.stat?.start_time ? (Date.now() / 1000) - Bot.stat.start_time : process.uptime()
            },
            bots,
            processesTop5,
    taskers: Bot.tasker,
    workflows: {
      stats: workflowStats,
      items: workflowList
    }
  };

  snapshot.panels = buildPanelPayload(snapshot);
  return snapshot;
}

function buildPanelPayload(snapshot) {
  const system = snapshot.system;
  const bots = snapshot.bots;
  const workflows = snapshot.workflows;
  const botSummary = summarizeBots(bots);

  const disk = Array.isArray(system.disks) && system.disks[0];
  const diskUsage = disk && disk.size > 0 ? ((disk.used / disk.size) * 100).toFixed(1) : 0;

  return {
    metrics: {
      cpu: system.cpu.percent || 0,
      memory: Number(system.memory.usagePercent) || 0,
      disk: Number(diskUsage) || 0,
      swap: system.swap.usagePercent || 0,
      net: system.netRates || { rxSec: 0, txSec: 0 }
    },
    bots: botSummary,
    workflows: {
      total: workflows.stats.total,
      enabled: workflows.stats.enabled,
      embeddingReady: workflows.stats.embedding?.ready || 0,
      mode: workflows.stats.embedding?.mode || 'local',
      items: workflows.items.slice(0, 5)
    },
    processes: snapshot.processesTop5 || [],
    interfaces: system.network
  };
}

/**
 * 核心系统API
 * 提供系统状态、配置查询、健康检查等基础功能
 */
export default {
  name: 'core',
  dsc: '核心系统API',
  priority: 200,
  init: async (app, Bot) => {
    __ensureNetSampler();
    __ensureSysSamplers();
  },

  routes: [
    {
      method: 'GET',
      path: '/api/system/status',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const includeHist = ['24h', '1', 'true'].includes(req.query?.hist) || ['1', 'true'].includes(req.query?.withHistory);
        const snapshot = await buildSystemSnapshot(Bot, { includeHistory: includeHist });
        res.json(snapshot);
      }, 'system.status')
    },

    {
      method: 'GET',
      path: '/api/system/overview',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const includeHist = ['24h', '1', 'true'].includes(req.query?.hist) || ['1', 'true'].includes(req.query?.withHistory);
        const snapshot = await buildSystemSnapshot(Bot, { includeHistory: includeHist });
        HttpResponse.success(res, {
          timestamp: snapshot.timestamp,
          system: snapshot.system,
          panels: snapshot.panels,
          workflows: snapshot.workflows,
          bots: snapshot.bots,
          processesTop5: snapshot.processesTop5,
          taskers: snapshot.taskers,
          network: {
            current: snapshot.system.netRates,
            recent: snapshot.system.netRecent,
            history: snapshot.system.netHistory24h
          }
        });
      }, 'system.overview')
    },

    {
      method: 'GET',
      path: '/api/status',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const snapshot = await buildSystemSnapshot(Bot, { includeHistory: false });
        HttpResponse.success(res, {
          system: snapshot.system,
          bot: snapshot.bot,
          bots: snapshot.bots,
          taskers: snapshot.taskers
        });
      }, 'status')
    },

    {
      method: 'GET',
      path: '/api/config',
      handler: async (req, res, Bot) => {
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

        HttpResponse.success(res, {
          config: serialize(cfg)
        });
      }
    },

    {
      method: 'GET',
      path: '/api/health',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        // 尝试获取 redis 实例（如果存在）
        let redisOk = false;
        try {
          const redis = global.redis || Bot.redis;
          if (redis && typeof redis.ping === 'function') {
            redisOk = await redis.ping().then(() => true).catch(() => false);
          }
        } catch (e) {
          // redis 不可用，忽略
        }
        
        HttpResponse.success(res, {
          status: 'healthy',
          timestamp: Date.now(),
          services: {
            bot: Bot.uin && Bot.uin.length > 0 ? 'operational' : 'degraded',
            redis: redisOk ? 'operational' : 'down',
            api: 'operational'
          }
        });
      }, 'health')
    }
  ]
};