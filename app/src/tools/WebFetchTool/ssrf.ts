/**
 * SSRF Protection
 * 对标 OpenClaw agent/web-fetch.ssrf.ts + Hermes tools/url_safety.py
 * 服务端请求伪造防护，检测并阻断内网/元数据请求
 *
 * O22（2026-09-12）：补齐**例外机制**。此前只抄了上游的拦截规则、没抄逃生门
 * （整个 app/src 无 `allowRfc2544 / allowPrivate / ALLOW_PRIVATE` 任何开关），
 * 导致 fake-ip 代理环境（Clash / sing-box / Surge / 深信服 aTrust 等把**所有**外网
 * 域名解析到 RFC 2544 段）下 WebFetch **100% 全废**，且报错把用户误导成"该网站不安全"。
 */

import * as net from 'net';
import * as dns from 'dns';
import { configManager } from '@modules/config';
import { normalizeUrl } from './utils.js';

export interface SsrfCheckResult {
  safe: boolean;
  blocked: boolean;
  reason?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  details?: SsrfBlockDetail[];
}

export interface SsrfBlockDetail {
  type: SsrfBlockType;
  description: string;
  value: string;
}

export type SsrfBlockType =
  | 'private_ip'
  | 'loopback_ip'
  | 'link_local'
  | 'metadata_ip'
  | 'internal_hostname'
  | 'dns_rebind'
  | 'ip_variant'
  | 'unexpected_port'
  | 'unknown_protocol';

const PRIVATE_IP_RANGES = [
  {
    start: '10.0.0.0',
    end: '10.255.255.255',
    type: 'private_ip' as SsrfBlockType,
  },
  {
    start: '172.16.0.0',
    end: '172.31.255.255',
    type: 'private_ip' as SsrfBlockType,
  },
  {
    start: '192.168.0.0',
    end: '192.168.255.255',
    type: 'private_ip' as SsrfBlockType,
  },
  // CGNAT / Shared Address Space（RFC 6598）：运营商级 NAT、Tailscale/WireGuard 等内网段
  // （对标 Hermes url_safety.py 的 _CGNAT_NETWORK）
  {
    start: '100.64.0.0',
    end: '100.127.255.255',
    type: 'private_ip' as SsrfBlockType,
  },
];

/**
 * Benchmark / 代理测试段（RFC 2544，198.18.0.0/15）—— **单独成项，可被策略显式放行**
 *
 * ⚠️ 该段被 **fake-ip 代理**大量占用：Clash / sing-box / Surge / 深信服 aTrust 等
 * 零信任客户端会把**所有外网域名**先解析到该段（建连时代换真实地址）。对它一律拦截
 * 会让"所有外网抓取 100% 失败"，且报错会误导用户以为目标网站不安全。
 *
 * 默认仍**拦截**（安全默认）；确认环境可信时用 `TOOL_WEB_FETCH_ALLOW_RFC2544=true` 放行。
 * 对标 OpenClaw `SsrFPolicy.allowRfc2544BenchmarkRange`。
 */
const RFC2544_RANGE = {
  start: '198.18.0.0',
  end: '198.19.255.255',
  type: 'private_ip' as SsrfBlockType,
};

/** 放行 RFC 2544 段的环境变量名（唯一配置入口，见 app/.env.example「工具配置」） */
export const ENV_ALLOW_RFC2544 = 'TOOL_WEB_FETCH_ALLOW_RFC2544';

/**
 * SSRF 策略（逃生门）
 *
 * 原则：只放行"确有需要且风险可控"的例外，其余一律保持拦截。
 * 放行 RFC 2544 段**不会**放开回环 / 私网 / 链路本地 / 云元数据地址。
 */
export interface SsrfPolicy {
  /** 放行 RFC 2544 基准段（198.18.0.0/15）：仅供 fake-ip 代理环境使用，默认 false */
  allowRfc2544BenchmarkRange?: boolean;
}

/**
 * 读取运行时策略
 *
 * 唯一读取入口用 `configManager.env`（项目 R05-012 禁止裸 `process.env`）。
 * 未显式传策略时 `checkSsrf` 即调用本函数，因此两个调用点（首跳 + 重定向逐跳）自动一致。
 */
export function resolveSsrfPolicy(): SsrfPolicy {
  return {
    allowRfc2544BenchmarkRange: configManager.env(ENV_ALLOW_RFC2544) === 'true',
  };
}

/** 本次检查实际生效的私网段（策略放行时移除 RFC 2544 段，其余保持不变） */
function privateRangesFor(policy: SsrfPolicy) {
  return policy.allowRfc2544BenchmarkRange
    ? PRIVATE_IP_RANGES
    : [...PRIVATE_IP_RANGES, RFC2544_RANGE];
}

const LOOPBACK_RANGES = [
  {
    start: '127.0.0.0',
    end: '127.255.255.255',
    type: 'loopback_ip' as SsrfBlockType,
  },
  {
    start: '0.0.0.0',
    end: '0.255.255.255',
    type: 'loopback_ip' as SsrfBlockType,
  },
];

const LINK_LOCAL_RANGES = [
  {
    start: '169.254.0.0',
    end: '169.254.255.255',
    type: 'link_local' as SsrfBlockType,
  },
];

const METADATA_IPS = [
  {
    ip: '169.254.169.254',
    type: 'metadata_ip' as SsrfBlockType,
    description: 'Cloud metadata service (AWS/GCP/Azure)',
  },
  {
    ip: '100.100.100.200',
    type: 'metadata_ip' as SsrfBlockType,
    description: 'Aliyun metadata service',
  },
];

const INTERNAL_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
];

const INTERNAL_TLDS = ['.internal', '.local', '.corp', '.intranet', '.private'];

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function isIpInRange(ip: string, start: string, end: string): boolean {
  const ipInt = ipToInt(ip);
  return ipInt >= ipToInt(start) && ipInt <= ipToInt(end);
}

function detectIpVariants(hostname: string): boolean {
  const ipVariantPatterns = [
    /^0+$/, // all zeros
    /^0x[0-9a-f]+$/i, // hex IP
    /^\d+$/, // decimal integer IP
    /^[0-9a-f]{32}$/i, // IPv6 without colons
    /^0+\.0+\.0+\.\d+$/, // leading zeros
    /^127\.\d+$/, // short 127.x
    /^2130706433$/, // 127.0.0.1 as decimal
  ];

  return ipVariantPatterns.some((p) => p.test(hostname));
}

async function resolveHostname(hostname: string): Promise<string[]> {
  try {
    const addresses = await dns.promises.resolve4(hostname);
    return addresses;
  } catch {
    return [];
  }
}

export async function checkSsrf(
  url: string,
  policy?: SsrfPolicy
): Promise<SsrfCheckResult> {
  // O22：未显式传策略时按配置解析（默认全拦；fake-ip 代理环境可显式放行 RFC 2544 段）
  const effectivePolicy = policy ?? resolveSsrfPolicy();
  const privateRanges = privateRangesFor(effectivePolicy);
  /** 是否因 RFC 2544 段被拦 —— 用于给出"这是代理假 IP"的准确提示，而非误导用户 */
  let rfc2544Blocked = false;
  const details: SsrfBlockDetail[] = [];

  const normalized = normalizeUrl(url);
  if (!normalized) {
    return {
      safe: false,
      blocked: true,
      reason: 'Invalid URL',
      riskLevel: 'medium',
      details,
    };
  }

  if (!['http:', 'https:'].includes(normalized.protocol)) {
    details.push({
      type: 'unknown_protocol',
      description: `Unsupported protocol: ${normalized.protocol}`,
      value: normalized.protocol,
    });
    return {
      safe: false,
      blocked: true,
      reason: 'Blocked by SSRF protection: unsupported protocol',
      riskLevel: 'medium',
      details,
    };
  }

  const hostname = normalized.hostname;

  if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
    if (net.isIPv6(hostname)) {
      details.push({
        type: 'ip_variant',
        description: 'IPv6 address',
        value: hostname,
      });
      return {
        safe: false,
        blocked: true,
        reason: 'Blocked by SSRF protection: IPv6 not allowed',
        riskLevel: 'high',
        details,
      };
    }

    for (const range of LOOPBACK_RANGES) {
      if (isIpInRange(hostname, range.start, range.end)) {
        details.push({
          type: range.type,
          description: 'Loopback IP range',
          value: hostname,
        });
      }
    }

    for (const range of privateRanges) {
      if (isIpInRange(hostname, range.start, range.end)) {
        if (range === RFC2544_RANGE) rfc2544Blocked = true;
        details.push({
          type: range.type,
          description: 'Private IP range',
          value: hostname,
        });
      }
    }

    for (const range of LINK_LOCAL_RANGES) {
      if (isIpInRange(hostname, range.start, range.end)) {
        details.push({
          type: range.type,
          description: 'Link-local IP range',
          value: hostname,
        });
      }
    }

    for (const meta of METADATA_IPS) {
      if (hostname === meta.ip) {
        details.push({
          type: meta.type,
          description: meta.description,
          value: hostname,
        });
      }
    }
  } else {
    const lowerHost = hostname.toLowerCase();

    if (INTERNAL_HOSTNAMES.includes(lowerHost)) {
      details.push({
        type: 'internal_hostname',
        description: 'Internal hostname',
        value: hostname,
      });
    }

    if (INTERNAL_TLDS.some((tld) => lowerHost.endsWith(tld))) {
      details.push({
        type: 'internal_hostname',
        description: 'Internal TLD detected',
        value: hostname,
      });
    }

    if (detectIpVariants(lowerHost)) {
      details.push({
        type: 'ip_variant',
        description: 'IP address variant (obfuscated)',
        value: hostname,
      });
    }

    if (details.length === 0) {
      const resolvedIps = await resolveHostname(hostname);

      for (const ip of resolvedIps) {
        for (const range of [
          ...LOOPBACK_RANGES,
          ...privateRanges,
          ...LINK_LOCAL_RANGES,
        ]) {
          if (isIpInRange(ip, range.start, range.end)) {
            if (range === RFC2544_RANGE) rfc2544Blocked = true;
            details.push({
              type: range.type,
              description: `DNS resolved to ${range.type.replace('_', ' ')}: ${ip}`,
              value: ip,
            });
            break;
          }
        }

        for (const meta of METADATA_IPS) {
          if (ip === meta.ip) {
            details.push({
              type: meta.type,
              description: meta.description,
              value: ip,
            });
          }
        }
      }
    }
  }

  if (details.length > 0) {
    const hasCritical = details.some(
      (d) => d.type === 'metadata_ip' || d.type === 'ip_variant'
    );

    let reason = `Blocked by SSRF protection: ${details[0].description}`;
    if (rfc2544Blocked) {
      // O22：给出可操作提示 —— 该段常是 fake-ip 代理的"假 IP"，不是目标站点不安全
      reason +=
        `（该地址位于 RFC 2544 基准段 198.18.0.0/15：若本机使用 fake-ip 代理` +
        `（Clash / sing-box / Surge / 深信服 aTrust 等），外网域名会被解析到该段，属正常现象；` +
        `确认环境可信后可设 ${ENV_ALLOW_RFC2544}=true 放行）`;
    }

    return {
      safe: false,
      blocked: true,
      reason,
      riskLevel: hasCritical ? 'critical' : 'high',
      details,
    };
  }

  return { safe: true, blocked: false, riskLevel: 'low', details };
}

export function hasSsrfBypassPattern(url: string): boolean {
  const bypassPatterns = [
    /@127\.0\.0\.1/,
    /@localhost/,
    /\.0x[0-9a-f]+\./i,
    /\[::1\]/,
    /%00/,
    /\.\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // dotted decimal at end of hostname
    /redirect.*=.*localhost/i,
    /redirect.*=.*127\.0\.0\.1/i,
    /proxy.*=.*localhost/i,
    /url.*=.*169\.254/i,
  ];

  return bypassPatterns.some((p) => p.test(url));
}
