/**
 * 服务器网络/配置访问辅助（host/url/代理、本机 IP、对外 URL、启动地址展示）
 * 从 AgentRuntime 拆出，供 listen/proxy/boot 与 facade 共用。
 */
import dgram from 'node:dgram';
import os from 'node:os';
import chalk from 'chalk';
import RuntimeUtil from '#utils/runtime-util.js';
import runtimeConfig from '#infrastructure/config/config.js';

export function getServerHost() {
  const host = runtimeConfig?.server?.server?.host;
  return (typeof host === 'string' && host.trim()) ? host.trim() : '0.0.0.0';
}

export function getConfiguredServerUrl() {
  const configuredUrl = runtimeConfig?.server?.server?.url;
  return (typeof configuredUrl === 'string') ? configuredUrl.trim() : '';
}

export function getProxyConfig() {
  return runtimeConfig?.server?.proxy || {};
}

export function isHttpsEnabled() {
  return runtimeConfig?.server?.https?.enabled === true;
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 * @param {string} [override='']
 */
export function getPublicServerUrl(runtime, override = '') {
  const trimmed = typeof override === 'string' ? override.trim() : '';
  if (trimmed) {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `${isHttpsEnabled() ? 'https' : 'http'}://${trimmed.replace(/^\/+/, '')}`;
    try {
      return new URL(withScheme).toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  const proxyConfig = getProxyConfig();
  if (runtime.proxyEnabled && Array.isArray(proxyConfig.domains) && proxyConfig.domains[0]) {
    const domain = proxyConfig.domains[0];
    const protocol = domain.ssl?.enabled ? 'https' : 'http';
    return `${protocol}://${domain.domain}`.replace(/\/+$/, '');
  }

  const configuredUrl = getConfiguredServerUrl();
  if (configuredUrl) {
    const withScheme = /^https?:\/\//i.test(configuredUrl)
      ? configuredUrl
      : `${isHttpsEnabled() ? 'https' : 'http'}://${configuredUrl.replace(/^\/+/, '')}`;
    try {
      return new URL(withScheme).toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  return '';
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 * @param {string} protocol
 * @param {number} port
 */
export async function displayAccessUrls(runtime, protocol, port) {
  const ipInfo = await getLocalIpAddress(runtime);

  console.log(chalk.cyan('\n▶ 访问地址：'));

  if (ipInfo.local.length > 0) {
    console.log(chalk.yellow('  本地网络：'));
    ipInfo.local.forEach((info) => {
      const url = `${protocol}://${info.ip}:${port}`;
      const label = info.primary ? chalk.green(' ★') : '';
      const interfaceInfo = chalk.gray(` [${info.interface}]`);
      console.log(`    ${chalk.cyan('•')} ${chalk.white(url)}${interfaceInfo}${label}`);
    });
  }

  if (ipInfo.public && runtimeConfig.server?.misc?.detectPublicIP !== false) {
    console.log(chalk.yellow('\n  公网访问：'));
    const publicUrl = `${protocol}://${ipInfo.public}:${port}`;
    console.log(`    ${chalk.cyan('•')} ${chalk.white(publicUrl)}`);
  }

  const configuredUrl = getConfiguredServerUrl();
  if (configuredUrl) {
    console.log(chalk.yellow('\n  配置域名：'));

    let normalizedUrl = configuredUrl;
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `${protocol}://${normalizedUrl}`;
    }

    let displayUrl = normalizedUrl.replace(/\/$/, '');
    try {
      const parsed = new URL(normalizedUrl);
      if (!parsed.port) {
        parsed.port = String(port);
      }
      displayUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
    } catch {
      const hasPort = /:[0-9]+$/.test(normalizedUrl.split('://')[1] || '');
      if (!hasPort) {
        displayUrl = `${normalizedUrl}:${port}`;
      }
    }

    console.log(`    ${chalk.cyan('•')} ${chalk.white(displayUrl)}`);
  }
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 */
export async function getLocalIpAddress(runtime) {
  const cacheKey = 'local_ip_addresses';
  const cached = runtime._cache.get(cacheKey);
  if (cached) return cached;

  const result = {
    local: [],
    public: null,
    primary: null
  };

  try {
    const interfaces = os.networkInterfaces();

    for (const [name, ifaces] of Object.entries(interfaces)) {
      if (name.toLowerCase().includes('lo')) continue;

      for (const iface of ifaces) {
        if (iface.family !== 'IPv4' || iface.internal) continue;

        result.local.push({
          ip: iface.address,
          interface: name,
          mac: iface.mac,
          virtual: isVirtualInterface(name)
        });
      }
    }

    try {
      result.primary = await getIpByUdp();
      const existingItem = result.local.find((item) => item.ip === result.primary);
      if (existingItem) {
        existingItem.primary = true;
      }
    } catch { /* probe optional */ }

    if (runtimeConfig.server?.misc?.detectPublicIP !== false) {
      result.public = await getPublicIP();
    }

    runtime._cache.set(cacheKey, result);
    return result;
  } catch (err) {
    RuntimeUtil.makeLog('debug', `获取IP地址失败：${err.message}`, '服务器');
    return result;
  }
}

function isVirtualInterface(name) {
  const virtualPatterns = [
    /^(docker|br-|veth|virbr|vnet)/i,
    /^(vmnet|vmware)/i,
    /^(vboxnet|virtualbox)/i
  ];
  return virtualPatterns.some((p) => p.test(name));
}

function getIpByUdp() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const udpCfg = runtimeConfig.server?.misc?.udpProbe || {};
    const probeHost = (udpCfg.host && String(udpCfg.host).trim()) || '223.5.5.5';
    const probePort = Number(udpCfg.port) || 80;
    const timeoutMs = Number(udpCfg.timeoutMs) || 3000;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('UDP超时'));
    }, timeoutMs);

    try {
      socket.connect(probePort, probeHost, () => {
        clearTimeout(timeout);
        const address = socket.address();
        socket.close();
        resolve(address.address);
      });
    } catch (err) {
      clearTimeout(timeout);
      socket.close();
      reject(err);
    }
  });
}

function isValidIP(ip) {
  if (!ip) return false;
  const ipv4Regex = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  return ipv4Regex.test(ip);
}

async function getPublicIP() {
  const apis = (Array.isArray(runtimeConfig.server?.misc?.publicIpApis) && runtimeConfig.server.misc.publicIpApis.length)
    ? runtimeConfig.server.misc.publicIpApis
    : [
      'https://ifconfig.me/ip',
      'https://api.ipify.org',
      'https://icanhazip.com',
      'https://ipinfo.io/ip'
    ];
  const timeoutMs = Number(runtimeConfig.server?.misc?.publicIpTimeoutMs) || 3000;

  for (const apiUrl of apis) {
    try {
      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'text/plain, */*'
        }
      });
      if (response.ok) {
        const ip = (await response.text()).trim();
        if (ip && isValidIP(ip)) {
          return ip;
        }
      }
    } catch {
      continue;
    }
  }

  RuntimeUtil.makeLog('debug', '获取公网IP失败，所有API均不可用', '服务器');
  return null;
}
