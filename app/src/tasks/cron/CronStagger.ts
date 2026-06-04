/**
 * Cron 错峰执行
 * 分散整点/密集 cron 触发的瞬时负载
 * 对标 openclaw src/cron/stagger.ts
 */

import { createHash } from 'node:crypto';

const DEFAULT_TOP_OF_HOUR_STAGGER_MS = 5 * 60 * 1000; // 5 分钟窗口
const STAGGER_OFFSET_CACHE_MAX = 4096;
const staggerOffsetCache = new Map<string, number>();

/**
 * 判断是否为整点 cron 表达式
 * (分钟字段为 0，小时字段包含 *)
 */
export function isTopOfHourCronExpr(expr: string): boolean {
  const fields = expr.trim().split(/\s+/).filter(Boolean);
  if (fields.length === 5) {
    const [minuteField, hourField] = fields;
    return minuteField === '0' && hourField.includes('*');
  }
  if (fields.length === 6) {
    const [, minuteField, hourField] = fields;
    return minuteField === '0' && hourField.includes('*');
  }
  return false;
}

/**
 * 基于 jobId 哈希计算错峰偏移量
 * 相同 jobId 始终得到相同偏移量，确保确定性
 */
export function resolveStaggerOffsetMs(
  jobId: string,
  staggerMs: number
): number {
  if (staggerMs <= 1) return 0;

  const cacheKey = `${staggerMs}:${jobId}`;
  const cached = staggerOffsetCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const digest = createHash('sha256').update(jobId).digest();
  // 使用前 4 字节取模
  const offset = digest.readUInt32BE(0) % staggerMs;

  if (staggerOffsetCache.size >= STAGGER_OFFSET_CACHE_MAX) {
    const first = staggerOffsetCache.keys().next().value;
    if (first) staggerOffsetCache.delete(first);
  }
  staggerOffsetCache.set(cacheKey, offset);
  return offset;
}

/**
 * 获取 cron 表达式的错峰延迟（毫秒）
 * 整点表达式自动分配 5 分钟窗口，非整点返回 0
 */
export function resolveCronStaggerMs(
  expr: string,
  jobId: string,
  explicitStaggerMs?: number
): number {
  if (explicitStaggerMs !== undefined && explicitStaggerMs > 0) {
    return explicitStaggerMs;
  }
  if (isTopOfHourCronExpr(expr)) {
    return DEFAULT_TOP_OF_HOUR_STAGGER_MS;
  }
  return 0;
}

/** 测试用：清空缓存 */
export function clearStaggerCacheForTest(): void {
  staggerOffsetCache.clear();
}
