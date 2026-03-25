/**
 * OpenClaw 风格 SSRF 防护（精简）：解析 URL + DNS 解析后校验目标 IP
 * 完整版见 openclaw/src/infra/net/ssrf.ts + fetch-guard
 */
import dns from 'node:dns/promises';
import net from 'node:net';

export class SsrFBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrFBlockedError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal'
]);

function ipv4ToUint32(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** 127/10/172.16-31/192.168/169.254/0 */
export function isPrivateOrReservedIpv4(ip) {
  const n = ipv4ToUint32(ip);
  if (n === null) return true;
  const a = n >>> 24;
  const b = (n >>> 16) & 255;
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (n === 0) return true;
  return false;
}

export function isBlockedIpv6(ip) {
  const x = ip.toLowerCase().trim();
  if (x === '::1') return true;
  if (x.startsWith('fc') || x.startsWith('fd')) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(x)) return true;
  const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) return isPrivateOrReservedIpv4(m[1]);
  return false;
}

/**
 * @param {string} urlString
 * @param {{ allowPrivateNetwork?: boolean, dangerouslyAllowPrivateNetwork?: boolean }} [policy]
 */
export async function assertUrlSafeForFetch(urlString, policy = {}) {
  const allowPrivate =
    policy.allowPrivateNetwork === true || policy.dangerouslyAllowPrivateNetwork === true;

  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new SsrFBlockedError('Invalid URL: must be http or https');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrFBlockedError('Invalid URL: must be http or https');
  }

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    throw new SsrFBlockedError(`Blocked hostname: ${host}`);
  }

  if (net.isIPv4(host)) {
    if (!allowPrivate && isPrivateOrReservedIpv4(host)) {
      throw new SsrFBlockedError('Blocked private or reserved IPv4');
    }
    return;
  }
  if (net.isIPv6(host)) {
    if (!allowPrivate && isBlockedIpv6(host)) {
      throw new SsrFBlockedError('Blocked loopback/private IPv6');
    }
    return;
  }

  let address;
  try {
    const r = await dns.lookup(host, { verbatim: true });
    address = r.address;
  } catch (e) {
    throw new SsrFBlockedError(`DNS lookup failed: ${e.message}`);
  }

  if (net.isIPv4(address)) {
    if (!allowPrivate && isPrivateOrReservedIpv4(address)) {
      throw new SsrFBlockedError('DNS resolved to private IPv4');
    }
  } else if (net.isIPv6(address)) {
    if (!allowPrivate && isBlockedIpv6(address)) {
      throw new SsrFBlockedError('DNS resolved to private IPv6');
    }
  }
}
