/**
 * 代理工具
 *
 * 2026-11-03（网络出口根因修复）：原实现**只读环境变量**。Windows 的系统代理
 * （`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的
 * `ProxyEnable` / `ProxyServer`）是用户实际配置的代理，但 Bun / Node 的 `fetch`
 * **不会继承它**（只认 `HTTP(S)_PROXY` / `ALL_PROXY` 环境变量）。
 *
 * 后果（实测）：本机系统代理 `127.0.0.1:<port>` 完全可用（经它请求 Hürriyet /
 * DuckDuckGo 均 200），而工具出站走直连 ⇒ Google / 土耳其站点 `ECONNREFUSED`、
 * Bing 按出口 IP 返回中文区结果，被误读为"世界上没有这些内容"。
 *
 * 解析顺序：环境变量（HTTPS_PROXY > HTTP_PROXY > ALL_PROXY）> Windows 系统代理 > 直连。
 * 绕过名单：`NO_PROXY` 优先，其次系统 `ProxyOverride`（支持 `*` / `<local>` / `.domain` / CIDR）。
 */

import { execFileSync } from 'node:child_process';
import { SYSTEM_PROXY_CACHE_TTL_MS } from '@openliri/infra/constants/network';
import { readUtilEnv } from './envAccess';
import { getLogger } from '@openliri/kernel/loggerFacade';
import { handleError } from '@openliri/kernel/errorHandler';

const logger = getLogger('utils:proxy');

const INTERNET_SETTINGS_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

export type ProxySource = 'env' | 'system' | 'none';

export interface ProxyResolution {
  /** 可直接交给 fetch 的代理 URL（已补 scheme）；无代理时 undefined */
  proxyUrl?: string;
  /** 生效来源：仅用于诊断，不参与判定 */
  source: ProxySource;
  /** 因绕过名单命中而直连 */
  bypassed: boolean;
  /** 命中的绕过规则（`bypassed` 为真时给出，便于解释"为什么没走代理"） */
  bypassRule?: string;
}

export interface SystemProxySettings {
  enabled: boolean;
  /** 原始 `ProxyServer` 值（可能是 `host:port` 或 `http=…;https=…`） */
  server?: string;
  /** 原始 `ProxyOverride` 值（`;` 分隔） */
  override?: string;
}

let cachedSystemProxy: {
  at: number;
  value: SystemProxySettings | null;
} | null = null;

/** 测试用：清空系统代理缓存（生产路径由 60s TTL 自动失效） */
export function resetSystemProxyCache(): void {
  cachedSystemProxy = null;
}

/**
 * 读取 Windows 系统代理（注册表）。非 Windows 或读取失败 ⇒ null。
 * 结果缓存 60s：代理设置变更不需要秒级生效，但要避免每个请求都起子进程。
 */
export function readSystemProxySettings(now: number = Date.now()): SystemProxySettings | null {
  if (process.platform !== 'win32') return null;
  if (
    cachedSystemProxy &&
    now - cachedSystemProxy.at < SYSTEM_PROXY_CACHE_TTL_MS
  ) {
    return cachedSystemProxy.value;
  }

  let value: SystemProxySettings | null = null;
  try {
    const output = execFileSync('reg', ['query', INTERNET_SETTINGS_KEY], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const enableMatch = /ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output);
    const serverMatch = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(output);
    const overrideMatch = /ProxyOverride\s+REG_SZ\s+([^\r\n]+)/i.exec(output);
    value = {
      enabled: enableMatch ? parseInt(enableMatch[1], 16) === 1 : false,
      server: serverMatch?.[1]?.trim(),
      override: overrideMatch?.[1]?.trim(),
    };
  } catch (error) {
    // 注册表读取失败（非 Windows / reg 不可用 / 无该键）不阻断出站：当作"无系统代理"
    handleError(error, {
      module: 'utils:proxy',
      action: 'readSystemProxySettings',
    });
    value = null;
  }

  cachedSystemProxy = { at: now, value };
  return value;
}

/**
 * 归一化代理值：补 `http://` scheme，并处理 Windows 的
 * `http=host:port;https=host:port` 复合格式。
 */
export function normalizeProxyUrl(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  if (trimmed.includes('=')) {
    const parts = new Map<string, string>();
    for (const item of trimmed.split(';')) {
      const eq = item.indexOf('=');
      if (eq > 0) {
        parts.set(item.slice(0, eq).trim().toLowerCase(), item.slice(eq + 1).trim());
      }
    }
    const chosen =
      parts.get('https') ?? parts.get('http') ?? parts.get('socks') ?? parts.get('socks5');
    return chosen ? normalizeProxyUrl(chosen) : undefined;
  }

  if (/^(?:https?|socks4|socks5|socks):\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed.replace(/^\/\//, '')}`;
}

function readEnvProxyUrl(): string | undefined {
  return normalizeProxyUrl(
    readUtilEnv('HTTPS_PROXY') ??
      readUtilEnv('https_proxy') ??
      readUtilEnv('HTTP_PROXY') ??
      readUtilEnv('http_proxy') ??
      readUtilEnv('ALL_PROXY') ??
      readUtilEnv('all_proxy')
  );
}

/**
 * 代理绕过名单：`NO_PROXY` 优先；未设置时用系统 `ProxyOverride`。
 * （系统代理生效时，`ProxyOverride` 才是用户真正的"直连名单"。）
 */
function resolveBypassPatterns(): string[] {
  const envNoProxy = readUtilEnv('NO_PROXY') ?? readUtilEnv('no_proxy');
  if (envNoProxy?.trim()) {
    return envNoProxy
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const system = readSystemProxySettings();
  if (system?.enabled && system.override?.trim()) {
    return system.override
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * 解析某次出站应使用的代理（**单一真源**：WebSearch / WebFetch / OTel 共用）。
 */
export function resolveProxyForUrl(url: string): ProxyResolution {
  const host = extractHostFromUrl(url);

  // 回环地址永远直连：本机服务（含本仓自己的 C/S 回环 API）绝不能绕到代理。
  // 这条是正确性守卫，不依赖用户是否在 ProxyOverride 里写了 `<local>`。
  if (host && isLoopbackHost(host)) {
    return { source: 'none', bypassed: true, bypassRule: 'loopback' };
  }

  const patterns = resolveBypassPatterns();
  if (host && patterns.length > 0) {
    const rule = patterns.find((pattern) =>
      matchesNoProxyPattern(host, pattern)
    );
    if (rule) {
      return { source: 'none', bypassed: true, bypassRule: rule };
    }
  }

  const resolved = resolveProxyWithoutBypass();
  return { ...resolved, bypassed: false };
}

/**
 * 只解析"有没有代理、来自哪"，不做绕过判定。
 *
 * 供**没有具体目标 URL** 的调用方（OTel 导出器、doctor 概览）使用 —— 这类场景
 * 不该为了解析面编造一个探测 URL 字面量（`lint:consts` 亦禁止同值 host 字面量扩散）。
 */
export function resolveProxyWithoutBypass(): {
  proxyUrl?: string;
  source: ProxySource;
} {
  const envProxy = readEnvProxyUrl();
  if (envProxy) {
    return { proxyUrl: envProxy, source: 'env' };
  }

  const system = readSystemProxySettings();
  if (system?.enabled) {
    const proxyUrl = normalizeProxyUrl(system.server);
    if (proxyUrl) {
      return { proxyUrl, source: 'system' };
    }
  }

  return { source: 'none' };
}

/**
 * 获取代理URL（环境变量优先，其次 Windows 系统代理）。
 * OTel 导出器等既有调用方无需关心来源。
 */
export function getProxyUrl(): string | undefined {
  return resolveProxyWithoutBypass().proxyUrl;
}

/**
 * 检查是否应该绕过代理
 */
export function shouldBypassProxy(url: string): boolean {
  return resolveProxyForUrl(url).bypassed;
}

/**
 * 从URL中提取主机名
 */
function extractHostFromUrl(url: string): string | null {
  try {
    // 处理没有协议的URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch (error) {
    handleError(error, { module: 'utils:proxy', action: 'extractHostFromUrl' });
    return null;
  }
}

/**
 * 检查主机名是否匹配NO_PROXY模式
 */
function matchesNoProxyPattern(host: string, pattern: string): boolean {
  const normalizedPattern = pattern.toLowerCase();
  const normalizedHost = host.toLowerCase();

  // Windows ProxyOverride 的两个特殊值：
  // `*` ⇒ 全部直连；`<local>` ⇒ 无点号的主机名（localhost / 单标签机器名）直连
  if (normalizedPattern === '*') {
    return true;
  }
  if (normalizedPattern === '<local>') {
    return !normalizedHost.includes('.');
  }

  // 精确匹配
  if (normalizedHost === normalizedPattern) {
    return true;
  }
  // `host:port` 形式（Windows 常见）
  if (normalizedHost === normalizedPattern.replace(/:\d+$/, '')) {
    return true;
  }

  // 子域名匹配（例如 .example.com 匹配 www.example.com）
  if (pattern.startsWith('.')) {
    const domain = pattern.substring(1);
    return host === domain || host.endsWith('.' + domain);
  }

  // IP地址匹配
  if (isIpAddress(host) && isIpAddress(pattern)) {
    return host === pattern;
  }

  // CIDR匹配
  if (pattern.includes('/')) {
    return matchesCidrPattern(host, pattern);
  }

  return false;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.')
  );
}

/**
 * 检查是否是IP地址
 */
function isIpAddress(host: string): boolean {
  const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  return ipRegex.test(host);
}

/**
 * 检查IP地址是否匹配CIDR模式
 */
function matchesCidrPattern(ip: string, cidr: string): boolean {
  try {
    const [cidrIp, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);

    if (isNaN(prefix) || prefix < 0 || prefix > 32) {
      return false;
    }

    const ipBytes = ip.split('.').map(Number);
    const cidrBytes = cidrIp.split('.').map(Number);

    if (ipBytes.length !== 4 || cidrBytes.length !== 4) {
      return false;
    }

    // 计算网络掩码
    const mask = (0xffffffff << (32 - prefix)) >>> 0;

    // 将IP地址转换为32位整数
    const ipInt =
      (ipBytes[0] << 24) | (ipBytes[1] << 16) | (ipBytes[2] << 8) | ipBytes[3];
    const cidrInt =
      (cidrBytes[0] << 24) |
      (cidrBytes[1] << 16) |
      (cidrBytes[2] << 8) |
      cidrBytes[3];

    // 检查是否在同一网络
    return (ipInt & mask) === (cidrInt & mask);
  } catch (error) {
    handleError(error, { module: 'utils:proxy', action: 'matchesCidrPattern' });
    return false;
  }
}
