/**
 * 代理工具
 */

import { isEnvTruthy } from './envUtils.js';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('utils:proxy');

/**
 * 获取代理URL
 */
export function getProxyUrl(): string | undefined {
  // 优先使用HTTPS代理
  if (configManager.env('HTTPS_PROXY')) {
    return configManager.env('HTTPS_PROXY');
  }
  // 其次使用HTTP代理
  if (configManager.env('HTTP_PROXY')) {
    return configManager.env('HTTP_PROXY');
  }
  // 最后使用ALL_PROXY
  if (configManager.env('ALL_PROXY')) {
    return configManager.env('ALL_PROXY');
  }
  return undefined;
}

/**
 * 检查是否应该绕过代理
 */
export function shouldBypassProxy(url: string): boolean {
  // 检查是否在NO_PROXY环境变量中
  const noProxy = configManager.env('NO_PROXY');
  if (!noProxy) {
    return false;
  }

  const host = extractHostFromUrl(url);
  if (!host) {
    return false;
  }

  const noProxyList = noProxy.split(',').map((item) => item.trim());
  for (const pattern of noProxyList) {
    if (matchesNoProxyPattern(host, pattern)) {
      return true;
    }
  }

  return false;
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
  // 精确匹配
  if (host === pattern) {
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
