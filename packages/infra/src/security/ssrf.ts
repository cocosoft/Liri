// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SSRF 防护（唯一事实源，P1 2026-11-22）
 *
 * 原实现位于 `app/src/tools/WebFetchTool/ssrf.ts`；为让 **browser（playwright 驱动）**
 * 与 **web_fetch** 共用同一判据（R30 禁止 `packages/tool-browser` 反向 import app），
 * 实现下沉到 infra；app 侧保留 re-export shim（既有 import / 测试零改动）。
 *
 * 覆盖：内网 / 回环 / 链路本地 / 云元数据 / 内部域名 / DNS 解析到内网 / 混淆 IP 形式。
 * 语义区分见 `describeSsrfBlock()`（`proxy_fake_ip` 是环境侧代理行为，不是内网目标）。
 */

import * as net from 'net';
import * as dns from 'dns';

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
  /** 代理 fake-IP 池（RFC 2544 `198.18.0.0/15`）：**环境侧代理行为**，与"真实内网目标"语义不同（见 `describeSsrfBlock`） */
  | 'proxy_fake_ip'
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
  {
    start: '100.64.0.0',
    end: '100.127.255.255',
    type: 'private_ip' as SsrfBlockType,
  },
];

/**
 * 代理 fake-IP 池（RFC 2544 基准段，`198.18.0.0/15`）。
 *
 * 命中本段**判定相同（一律阻断）**，但**语义与处置不同** —— 命中本段几乎总是
 * **环境侧代理行为**（Clash / mihomo 的 `fake-ip-range` 默认池、企业零信任客户端的
 * DNS 劫持），**并非内网目标**。面向模型/用户的文案区分见 `describeSsrfBlock()`。
 */
const FAKE_IP_RANGES = [
  {
    start: '198.18.0.0',
    end: '198.19.255.255',
    type: 'proxy_fake_ip' as SsrfBlockType,
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

/** 最小 URL 归一化（只取 SSRF 判定所需字段；无效 URL ⇒ null） */
function normalizeSsrfUrl(
  url: string
): { protocol: string; hostname: string } | null {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol.toLowerCase(),
      hostname: parsed.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

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
    return await dns.promises.resolve4(hostname);
  } catch {
    return [];
  }
}

export async function checkSsrf(url: string): Promise<SsrfCheckResult> {
  const details: SsrfBlockDetail[] = [];

  const normalized = normalizeSsrfUrl(url);
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

    for (const range of FAKE_IP_RANGES) {
      if (isIpInRange(hostname, range.start, range.end)) {
        details.push({
          type: range.type,
          description: 'Proxy fake-IP range (RFC 2544)',
          value: hostname,
        });
      }
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
          ...FAKE_IP_RANGES,
          ...LOOPBACK_RANGES,
          ...PRIVATE_IP_RANGES,
          ...LINK_LOCAL_RANGES,
        ]) {
          if (isIpInRange(ip, range.start, range.end)) {
            details.push({
              type: range.type,
              description: `DNS resolved to ${range.type.replace(/_/g, ' ')}: ${ip}`,
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

/** 命中"内网 / 本机 / 链路本地 / 云元数据 / 内部域名"这一类（**真实威胁信号**）的 block 类型 */
const INTERNAL_TARGET_TYPES: SsrfBlockType[] = [
  'private_ip',
  'loopback_ip',
  'link_local',
  'metadata_ip',
  'internal_hostname',
];

/**
 * 把拦截结果翻译成**模型与用户都能看懂**的说明。
 *
 * 设计要点：
 * - **两类分开说**：`proxy_fake_ip`（环境侧代理 fake-IP，**并非内网目标**，处置＝绕行）
 *   vs 其它内网类（**疑似真实威胁**）；
 * - **给替代路径**：看到阻断后可立刻换路，而不是反复重试同一 URL；
 * - **不丢诊断能力**：英文 `reason`、命中 IP、分段类型仍完整保留在 `details` 与日志中。
 */
export function describeSsrfBlock(
  result: SsrfCheckResult,
  subject = '该 URL'
): string {
  const details = result.details ?? [];
  const kinds = new Set<SsrfBlockType>(details.map((d) => d.type));
  const prefix = `${subject}已被安全策略阻断（SSRF / DNS rebinding 防护）：`;

  if (kinds.has('proxy_fake_ip')) {
    const ip =
      details.find((d) => d.type === 'proxy_fake_ip')?.value ?? '保留段地址';
    return (
      `${prefix}该域名在当前网络环境下被 DNS 解析到 ${ip}（属保留段 198.18.0.0/15，RFC 2544）。` +
      '这是企业接入客户端或代理（如 Clash / mihomo 的 fake-IP、深信服 aTrust 等）的常见行为，**并非内网目标**。\n' +
      '可改用：① 本地文件（file_read / file_convert）；② 请用户提供内容；③ 暂停该类代理后重试。'
    );
  }

  if (INTERNAL_TARGET_TYPES.some((t) => kinds.has(t))) {
    const target = details[0]?.value ?? '内部地址';
    return (
      `${prefix}该地址指向内网 / 本机 / 链路本地 / 云元数据服务（${target}）⇒ **疑似内网目标**（真实威胁信号），已阻断。\n` +
      '可改用：① 本地文件（file_read / file_convert）；② 请用户提供内容。'
    );
  }

  return `${prefix}${result.reason ?? '未知原因'}。`;
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
