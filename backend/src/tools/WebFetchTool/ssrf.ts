/**
 * SSRF Protection
 * 对标OpenClaw agent/web-fetch.ssrf.ts
 * 服务端请求伪造防护，检测并阻断内网/元数据请求
 */

import * as net from 'node:net';
import * as dns from 'node:dns';
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
];

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

export async function checkSsrf(url: string): Promise<SsrfCheckResult> {
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

    for (const range of PRIVATE_IP_RANGES) {
      if (isIpInRange(hostname, range.start, range.end)) {
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
          ...PRIVATE_IP_RANGES,
          ...LINK_LOCAL_RANGES,
        ]) {
          if (isIpInRange(ip, range.start, range.end)) {
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

    return {
      safe: false,
      blocked: true,
      reason: `Blocked by SSRF protection: ${details[0].description}`,
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
