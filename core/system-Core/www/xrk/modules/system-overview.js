/**
 * 系统概览（Home：系统资源 / 网络流量 / 进程 Top5）的 UI 渲染与图表更新
 * 目标：把 app.js 中与“系统状态面板”相关的逻辑下沉，降低耦合
 */

import { setUpdating, clearUpdating } from './dom.js';

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function calcUsagePercent(used, total) {
  const t = toFiniteNumber(total, 0);
  if (t <= 0) return 0;
  const u = toFiniteNumber(used, 0);
  return clampNumber((u / t) * 100, 0, 100);
}

export function renderNetworkInfo(app, network = {}, rates = {}) {
  const box = document.getElementById('networkInfo');
  if (!box) return;

  // 添加更新标记，用于CSS过渡
  setUpdating(box);
  const entries = Object.entries(network ?? {});
  if (!entries.length) {
    box.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin: 0 auto 12px; opacity: 0.3;">
          <path d="M21 16V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2z"/>
          <polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/>
          <polyline points="17,6 23,6 23,12"/>
        </svg>
        <p>暂无网络信息</p>
      </div>
    `;
    clearUpdating(box);
    return;
  }

  const rxSec = rates.rxSec ?? rates.rx ?? 0;
  const txSec = rates.txSec ?? rates.tx ?? 0;
  const rxFormatted = app.formatBytes(rxSec);
  const txFormatted = app.formatBytes(txSec);
  const rateText = `${rxFormatted}/s ↓ · ${txFormatted}/s ↑`;

  box.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;text-align:center;line-height:1.4;padding:8px;background:var(--bg-input);border-radius:var(--radius);border:1px solid var(--border)">
      <span style="color:var(--primary);font-weight:600">${rateText}</span>
    </div>
    ${entries.map(([name, info]) => {
      const address = info.address ?? '';
      const mac = info.mac ?? '';
      return `
      <div style="padding:12px;border-bottom:1px solid var(--border);transition:background var(--transition)" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
        <div style="font-weight:600;color:var(--text-primary);text-align:center;margin-bottom:4px">${app.escapeHtml(name)}</div>
        <div style="font-size:12px;color:var(--text-muted);text-align:center;line-height:1.4">
          <span class="mono">IP: ${app.escapeHtml(address)}</span>${mac ? ` <span class="mono">· MAC: ${app.escapeHtml(mac)}</span>` : ''}
        </div>
      </div>
    `;
    }).join('')}
  `;

  clearUpdating(box);
}

export function updateSystemStatus(app, data) {
  const { system } = data;
  const panels = data.panels ?? {};
  const metrics = panels.metrics ?? {};

  // 更新统计卡片
  const cpuPercent = clampNumber(toFiniteNumber(metrics.cpu ?? system?.cpu?.percent ?? 0, 0), 0, 100);
  const cpuEl = document.getElementById('cpuValue');
  if (cpuEl) cpuEl.textContent = `${cpuPercent.toFixed(1)}%`;

  const memUsed = system?.memory?.used ?? 0;
  const memTotal = system?.memory?.total ?? 1;
  const memPercent = toFiniteNumber(metrics.memory ?? calcUsagePercent(memUsed, memTotal), 0);
  const memEl = document.getElementById('memValue');
  if (memEl) memEl.textContent = `${memPercent}%`;

  const disks = system?.disks ?? [];
  const diskEl = document.getElementById('diskValue');
  if (diskEl) {
    if (typeof metrics.disk === 'number') {
      diskEl.textContent = `${clampNumber(toFiniteNumber(metrics.disk, 0), 0, 100).toFixed(1)}%`;
    } else if (disks.length > 0) {
      const disk = disks[0];
      const diskPercent = calcUsagePercent(disk.used, disk.size);
      diskEl.textContent = `${diskPercent.toFixed(1)}%`;
    } else {
      diskEl.textContent = '--';
    }
  }

  const uptimeEl = document.getElementById('uptimeValue');
  if (uptimeEl) {
    uptimeEl.textContent = app.formatTime((system && system.uptime) || (data.bot && data.bot.uptime) || 0);
  }

  // 更新网络历史：优先使用后端返回的实时数据
  const netRecent = system?.netRecent ?? [];
  const currentRxSec = Math.max(0, Number(metrics.net?.rxSec ?? system?.netRates?.rxSec ?? 0)) / 1024;
  const currentTxSec = Math.max(0, Number(metrics.net?.txSec ?? system?.netRates?.txSec ?? 0)) / 1024;

  // 如果后端返回了实时数据，直接使用
  if (netRecent.length > 0) {
    const recent = netRecent.slice(-60);
    app._metricsHistory.netRx = recent.map(h => Math.max(0, (h.rxSec || 0) / 1024));
    app._metricsHistory.netTx = recent.map(h => Math.max(0, (h.txSec || 0) / 1024));
  } else {
    // 如果没有实时数据，使用当前速率累积
    const now = Date.now();
    if (!app._metricsHistory._lastUpdate || (now - app._metricsHistory._lastUpdate) >= 3000) {
      // 每3秒添加一个新数据点
      app._metricsHistory.netRx.push(currentRxSec);
      app._metricsHistory.netTx.push(currentTxSec);
      app._metricsHistory._lastUpdate = now;
      // 保留最近60个点
      if (app._metricsHistory.netRx.length > 60) app._metricsHistory.netRx.shift();
      if (app._metricsHistory.netTx.length > 60) app._metricsHistory.netTx.shift();
    } else {
      // 更新最后一个数据点（实时更新当前值）
      if (app._metricsHistory.netRx.length > 0) {
        app._metricsHistory.netRx[app._metricsHistory.netRx.length - 1] = currentRxSec;
        app._metricsHistory.netTx[app._metricsHistory.netTx.length - 1] = currentTxSec;
      } else {
        // 如果数组为空，初始化
        app._metricsHistory.netRx = [currentRxSec];
        app._metricsHistory.netTx = [currentTxSec];
      }
    }
  }

  const procTable = document.getElementById('processTable');
  if (procTable) {
    if (Array.isArray(data.processesTop5) && data.processesTop5.length > 0) {
      procTable.innerHTML = data.processesTop5.map(p => `
        <tr>
            <td style="font-weight:500">${p.name || '未知进程'}</td>
            <td style="color:var(--text-muted);font-size:12px" class="mono">${p.pid || '--'}</td>
            <td style="color:${(p.cpu || 0) > 50 ? 'var(--warning)' : 'var(--text-primary)'};font-weight:500">${(p.cpu || 0).toFixed(1)}%</td>
            <td style="color:${(p.mem || 0) > 50 ? 'var(--warning)' : 'var(--text-primary)'};font-weight:500">${(p.mem || 0).toFixed(1)}%</td>
        </tr>
      `).join('');
    } else {
      procTable.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">暂无进程数据</td></tr>';
    }
  }

  // 更新图表（与上面文本口径一致：使用同一份数值）
  updateCharts(app, cpuPercent, memPercent);
}

/**
 * 注册 Chart 插件（避免重复注册）
 */
export function registerChartPlugins(app) {
  if (app._chartPluginsRegistered || !window.Chart) return;

  // CPU 图表中心标签插件
  const cpuLabelPlugin = {
    id: 'cpuLabel',
    afterDraw: (chart) => {
      if (chart.config.type !== 'doughnut' || chart.canvas.id !== 'cpuChart') return;
      const ctx = chart.ctx;
      const centerX = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
      const centerY = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
      const value = chart.data.datasets[0].data[0];
      ctx.save();
      const fontFamily = (getComputedStyle(document.body).fontFamily || '').split(',')[0].trim() || 'sans-serif';
      ctx.font = `500 14px ${fontFamily}`;
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary').trim();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${value.toFixed(1)}%`, centerX, centerY);
      ctx.restore();
    }
  };

  // 内存图表中心标签插件
  const memLabelPlugin = {
    id: 'memLabel',
    afterDraw: (chart) => {
      if (chart.config.type !== 'doughnut' || chart.canvas.id !== 'memChart') return;
      const ctx = chart.ctx;
      const centerX = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
      const centerY = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
      const value = chart.data.datasets[0].data[0];
      ctx.save();
      const fontFamily = (getComputedStyle(document.body).fontFamily || '').split(',')[0].trim() || 'sans-serif';
      ctx.font = `500 14px ${fontFamily}`;
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary').trim();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${value.toFixed(1)}%`, centerX, centerY);
      ctx.restore();
    }
  };

  Chart.register(cpuLabelPlugin, memLabelPlugin);
  app._chartPluginsRegistered = true;
}

export function updateCharts(app, cpu, mem) {
  if (!window.Chart) return;

  // 注册插件（仅一次）
  registerChartPlugins(app);

  const primary = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#0ea5e9';
  const success = getComputedStyle(document.body).getPropertyValue('--success').trim() || '#22c55e';
  const warning = getComputedStyle(document.body).getPropertyValue('--warning').trim() || '#f59e0b';
  const danger = getComputedStyle(document.body).getPropertyValue('--danger').trim() || '#ef4444';
  const border = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#e2e8f0';

  // CPU 图表
  const cpuCtx = document.getElementById('cpuChart');
  if (cpuCtx) {
    if (app._charts.cpu && app._charts.cpu.canvas !== cpuCtx) {
      app._charts.cpu.destroy();
      app._charts.cpu = null;
    }

    const cpuColor = cpu > 80 ? danger : cpu > 50 ? warning : primary;
    const cpuFree = 100 - cpu;

    if (!app._charts.cpu) {
      app._charts.cpu = new Chart(cpuCtx.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['使用', '空闲'],
          datasets: [{
            data: [cpu, cpuFree],
            backgroundColor: [cpuColor, border],
            borderWidth: 0
          }]
        },
        options: {
          cutout: '75%',
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          }
        }
      });
    } else {
      app._charts.cpu.data.datasets[0].data = [cpu, 100 - cpu];
      app._charts.cpu.data.datasets[0].backgroundColor = [cpuColor, border];
      app._charts.cpu.update('none');
    }
  }

  // 内存图表
  const memCtx = document.getElementById('memChart');
  if (memCtx) {
    if (app._charts.mem && app._charts.mem.canvas !== memCtx) {
      app._charts.mem.destroy();
      app._charts.mem = null;
    }

    const memColor = mem > 80 ? danger : mem > 50 ? warning : success;
    const memFree = 100 - mem;

    if (!app._charts.mem) {
      app._charts.mem = new Chart(memCtx.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['使用', '空闲'],
          datasets: [{
            data: [mem, memFree],
            backgroundColor: [memColor, border],
            borderWidth: 0
          }]
        },
        options: {
          cutout: '75%',
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          }
        }
      });
    } else {
      app._charts.mem.data.datasets[0].data = [mem, 100 - mem];
      app._charts.mem.data.datasets[0].backgroundColor = [memColor, border];
      app._charts.mem.update('none');
    }
  }

  // 网络图表
  const netCtx = document.getElementById('netChart');
  if (netCtx) {
    if (app._charts.net && app._charts.net.canvas !== netCtx) {
      app._charts.net.destroy();
      app._charts.net = null;
    }

    const textMuted = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#94a3b8';
    const labels = app._metricsHistory.netRx.map(() => '');

    if (!app._charts.net) {
      app._charts.net = new Chart(netCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '下行',
              data: app._metricsHistory.netRx,
              borderColor: primary,
              backgroundColor: `${primary}15`,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 4,
              borderWidth: 2,
              spanGaps: true
            },
            {
              label: '上行',
              data: app._metricsHistory.netTx,
              borderColor: warning,
              backgroundColor: `${warning}15`,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 4,
              borderWidth: 2,
              spanGaps: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: {
              position: 'bottom',
              display: true,
              labels: {
                color: textMuted,
                padding: 12,
                font: { size: 12 },
                usePointStyle: true,
                pointStyle: 'line'
              }
            },
            tooltip: {
              enabled: true,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              padding: 10,
              titleFont: { size: 12 },
              bodyFont: { size: 11 },
              cornerRadius: 6,
              displayColors: true,
              callbacks: {
                label: function(context) {
                  const value = context.parsed.y;
                  if (value === 0 || value < 0.01) return '';
                  return `${context.dataset.label}: ${value.toFixed(2)} KB/s`;
                },
                filter: function(tooltipItem) {
                  return tooltipItem.parsed.y > 0.01;
                }
              }
            }
          },
          scales: {
            x: {
              display: false,
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              suggestedMax: 10,
              grid: {
                color: border,
                drawBorder: false,
                lineWidth: 1
              },
              ticks: {
                display: false,
                maxTicksLimit: 5
              }
            }
          }
        }
      });
    } else {
      // 更新图表数据
      app._charts.net.data.labels = labels;
      app._charts.net.data.datasets[0].data = app._metricsHistory.netRx;
      app._charts.net.data.datasets[1].data = app._metricsHistory.netTx;

      // 动态调整Y轴范围，确保数据可见
      const allValues = [...app._metricsHistory.netRx, ...app._metricsHistory.netTx];
      const maxValue = Math.max(...allValues.filter(v => isFinite(v) && v > 0), 1);
      const yMax = Math.ceil(maxValue * 1.2);

      if (app._charts.net.options.scales?.y) {
        app._charts.net.options.scales.y.max = yMax;
        if (app._charts.net.options.scales.y.ticks) {
          app._charts.net.options.scales.y.ticks.display = false;
        }
      }

      // 更新tooltip配置，过滤0.0值
      if (app._charts.net.options.plugins?.tooltip) {
        app._charts.net.options.plugins.tooltip.callbacks = {
          label: function(context) {
            const value = context.parsed.y;
            if (value === 0 || value < 0.01) return '';
            return `${context.dataset.label}: ${value.toFixed(2)} KB/s`;
          },
          filter: function(tooltipItem) {
            return tooltipItem.parsed.y > 0.01;
          }
        };
      }

      app._charts.net.update('default');
    }
  }
}

