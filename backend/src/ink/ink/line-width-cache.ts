/**
 * 行宽缓存模块
 * 缓存文本行宽度计算结果
 */

import { stringWidth } from './stringWidth';

interface CacheEntry {
  width: number;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 1000;
const CACHE_TTL = 60000;

export function getLineWidth(text: string): number {
  const now = Date.now();
  
  const cached = cache.get(text);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.width;
  }

  const width = stringWidth(text);
  
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = Array.from(cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
    cache.delete(oldestKey);
  }

  cache.set(text, { width, timestamp: now });
  
  return width;
}

export function getLinesWidths(lines: string[]): number[] {
  return lines.map((line) => getLineWidth(line));
}

export function getMaxLineWidth(lines: string[]): number {
  return Math.max(...getLinesWidths(lines), 0);
}

export function clearLineWidthCache(): void {
  cache.clear();
}

export function getCacheSize(): number {
  return cache.size;
}

export function pruneStaleCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp >= CACHE_TTL) {
      cache.delete(key);
    }
  }
}