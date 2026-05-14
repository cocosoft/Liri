/**
 * WebFetch Utility Functions
 * 对标CC源码 WebFetchTool/utils.ts
 * WebFetch工具函数集：URL处理、内容检测、响应解析
 */

import type { PreapprovedEntry } from './preapproved.js';
import { isUrlPreapproved, isUrlBlocked, isUrlAllowed } from './preapproved.js';

export interface NormalizedUrl {
  original: string;
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  normalized: string;
}

export interface ContentTypeInfo {
  mimeType: string;
  charset: string;
  isHtml: boolean;
  isJson: boolean;
  isXml: boolean;
  isText: boolean;
  isBinary: boolean;
  isImage: boolean;
  isAudio: boolean;
  isVideo: boolean;
}

export interface UrlValidationResult {
  valid: boolean;
  normalized?: NormalizedUrl;
  preapproved?: PreapprovedEntry | null;
  blocked: boolean;
  error?: string;
}

export function normalizeUrl(url: string): NormalizedUrl | null {
  try {
    const parsed = new URL(url);
    const normalized = new URL(parsed.href);

    normalized.protocol = parsed.protocol.toLowerCase();
    normalized.hostname = parsed.hostname.toLowerCase();

    const result: NormalizedUrl = {
      original: url,
      protocol: normalized.protocol,
      hostname: normalized.hostname,
      port: normalized.port || (normalized.protocol === 'https:' ? '443' : '80'),
      pathname: normalized.pathname,
      search: normalized.search,
      hash: normalized.hash,
      normalized: normalized.href,
    };

    return result;
  } catch {
    return null;
  }
}

export function detectContentType(contentType: string): ContentTypeInfo {
  const parts = contentType.split(';').map((s) => s.trim());
  const mimeType = parts[0].toLowerCase();
  const charset = parts
    .find((p) => p.toLowerCase().startsWith('charset='))
    ?.split('=')[1]
    ?.toLowerCase() ?? 'utf-8';

  return {
    mimeType,
    charset,
    isHtml: mimeType.includes('text/html'),
    isJson: mimeType.includes('application/json'),
    isXml: mimeType.includes('application/xml') || mimeType.includes('text/xml'),
    isText: mimeType.startsWith('text/'),
    isBinary: !mimeType.startsWith('text/') && !mimeType.startsWith('application/json'),
    isImage: mimeType.startsWith('image/'),
    isAudio: mimeType.startsWith('audio/'),
    isVideo: mimeType.startsWith('video/'),
  };
}

export function validateRequestUrl(url: string): UrlValidationResult {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return { valid: false, blocked: false, error: 'Invalid URL format' };
  }

  if (!['http:', 'https:'].includes(normalized.protocol)) {
    return {
      valid: false,
      normalized,
      blocked: true,
      error: `Unsupported protocol: ${normalized.protocol}`,
    };
  }

  const preapproved = isUrlPreapproved(url);

  if (preapproved && !preapproved.allowed) {
    return {
      valid: false,
      normalized,
      preapproved,
      blocked: true,
      error: `URL blocked: ${preapproved.reason}`,
    };
  }

  return {
    valid: true,
    normalized,
    preapproved,
    blocked: false,
  };
}

export function extractTextFromHtml(html: string, maxLength?: number): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();

  if (maxLength && text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }

  return text;
}

export function extractMetaTags(html: string): Record<string, string> {
  const metaTags: Record<string, string> = {};

  const namePattern = /<meta\s+name=["']([^"']+)["']\s+content=["']([^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(html)) !== null) {
    metaTags[match[1].toLowerCase()] = match[2];
  }

  const propertyPattern = /<meta\s+property=["']([^"']+)["']\s+content=["']([^"']*)["']/gi;
  while ((match = propertyPattern.exec(html)) !== null) {
    metaTags[match[1].toLowerCase()] = match[2];
  }

  return metaTags;
}

export function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : undefined;
}

export function buildUserAgent(): string {
  return 'PY_APP/2.0 (WebFetch; compatible)';
}

export function buildDefaultHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': buildUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    ...extraHeaders,
  };
}

export function parseCookies(
  cookieString: string,
): Array<{ name: string; value: string }> {
  return cookieString.split(';').map((c) => {
    const [name, ...rest] = c.trim().split('=');
    return { name: name.trim(), value: rest.join('=').trim() };
  });
}

export function truncateContent(
  content: string,
  maxLength: number,
  truncationMessage?: string,
): string {
  if (content.length <= maxLength) {
    return content;
  }

  const message = truncationMessage
    ?? `\n\n[Content truncated. Original length: ${content.length} characters]`;
  return content.substring(0, maxLength) + message;
}

export {
  isUrlPreapproved,
  isUrlBlocked,
  isUrlAllowed,
};
