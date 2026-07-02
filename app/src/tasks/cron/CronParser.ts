/**
 * Cron 表达式解析器
 * 基于 croner 库，替代自实现的简易 5 段式解析
 * 对标 openclaw src/cron/schedule.ts
 */

import { Cron } from 'croner';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'tasks:cron:parser',
  level: LogLevel.INFO,
});

const CRON_EVAL_CACHE_MAX = 512;
const cronEvalCache = new Map<string, Cron>();

/**
 * 计算下次运行毫秒时间戳
 * @param expr cron 表达式 (5 段或 6 段)
 * @param nowMs 当前时间基准 (毫秒)
 * @param tz 时区 (如 Asia/Shanghai)，默认使用系统时区
 * @returns 下次运行毫秒时间戳，或 undefined 表示无下次
 */
export function computeNextCronRunMs(
  expr: string,
  nowMs: number,
  tz?: string
): number | undefined {
  const cron = resolveCachedCron(expr, tz);
  if (!cron) return undefined;

  let next = cron.nextRun(new Date(nowMs));
  if (!next) return undefined;

  let nextMs = next.getTime();
  if (!Number.isFinite(nextMs)) return undefined;

  // croner 有时区 bug 会导致返回过去的时间，尝试重新计算
  if (nextMs <= nowMs) {
    const nextSecondMs = Math.floor(nowMs / 1000) * 1000 + 1000;
    const retry = cron.nextRun(new Date(nextSecondMs));
    if (retry) {
      const retryMs = retry.getTime();
      if (Number.isFinite(retryMs) && retryMs > nowMs) return retryMs;
    }
    // 从明天 UTC 开始尝试
    const tomorrowMs = new Date(nowMs).setUTCHours(24, 0, 0, 0);
    const retry2 = cron.nextRun(new Date(tomorrowMs));
    if (retry2) {
      const retry2Ms = retry2.getTime();
      if (Number.isFinite(retry2Ms) && retry2Ms > nowMs) return retry2Ms;
    }
    return undefined;
  }

  return nextMs;
}

/**
 * 计算上次运行毫秒时间戳
 * @param expr cron 表达式
 * @param nowMs 当前时间基准 (毫秒)
 * @param tz 时区
 * @returns 上次运行毫秒时间戳，或 undefined
 */
export function computePreviousCronRunMs(
  expr: string,
  nowMs: number,
  tz?: string
): number | undefined {
  const cron = resolveCachedCron(expr, tz);
  if (!cron) return undefined;

  const previousRuns = cron.previousRuns(1, new Date(nowMs));
  const previous = previousRuns[0];
  if (!previous) return undefined;

  const previousMs = previous.getTime();
  if (!Number.isFinite(previousMs) || previousMs >= nowMs) return undefined;

  return previousMs;
}

/**
 * 计算从上次运行到当前时间应执行次数（missed job catch-up 用）
 */
export function computeMissedRuns(
  expr: string,
  lastRunMs: number,
  nowMs: number,
  tz?: string
): number {
  const cron = resolveCachedCron(expr, tz);
  if (!cron) return 0;

  let count = 0;
  let cursorMs = lastRunMs + 1;
  const maxIterations = 100;

  for (let i = 0; i < maxIterations; i++) {
    const next = cron.nextRun(new Date(cursorMs));
    if (!next) break;
    const nextMs = next.getTime();
    if (nextMs > nowMs) break;
    count++;
    cursorMs = nextMs;
  }

  return count;
}

/**
 * 将 cron 表达式转换为 ISO 时间字符串
 * @param expr cron 表达式
 * @param nowMs 当前时间基准
 * @param tz 时区
 * @returns ISO 时间字符串，或 null
 */
export function computeNextCronRun(
  expr: string,
  nowMs: number,
  tz?: string
): string | null {
  const ms = computeNextCronRunMs(expr, nowMs, tz);
  if (ms === undefined) return null;
  return new Date(ms).toISOString();
}

/**
 * 验证 cron 表达式是否合法
 */
export function isValidCronExpr(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  try {
    // 使用 catch: true 来避免 croner 抛出异常
    new Cron(expr, { catch: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取 croner 实例的易读描述
 */
export function getCronDescription(expr: string, tz?: string): string {
  const cron = resolveCachedCron(expr, tz);
  if (!cron) return expr;
  try {
    // croner 的 pattern 属性返回可读的英文描述
    const pattern = (cron as unknown as Record<string, unknown>).pattern;
    if (typeof pattern === 'string') return pattern;
    const next = cron.nextRun();
    return next ? `Next: ${next.toISOString()}` : expr;
  } catch {
    return expr;
  }
}

/** 解析系统时区 */
function resolveTimezone(tz?: string): string {
  return tz?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** LRU 缓存获取/创建 croner 实例 */
function resolveCachedCron(expr: string, tz?: string): Cron | undefined {
  const timezone = resolveTimezone(tz);
  const key = `${timezone}\u0000${expr}`;

  const cached = cronEvalCache.get(key);
  if (cached) {
    // LRU: 移到末尾
    cronEvalCache.delete(key);
    cronEvalCache.set(key, cached);
    return cached;
  }

  if (cronEvalCache.size >= CRON_EVAL_CACHE_MAX) {
    const oldest = cronEvalCache.keys().next().value;
    if (oldest) cronEvalCache.delete(oldest);
  }

  try {
    const next = new Cron(expr, { timezone, catch: false });
    cronEvalCache.set(key, next);
    return next;
  } catch {
    logger.warning('[CronParser] 无效 cron 表达式', { expr, tz: timezone });
    return undefined;
  }
}

/** 测试用：清空缓存 */
export function clearCronCacheForTest(): void {
  cronEvalCache.clear();
}

/** 测试用：获取缓存大小 */
export function getCronCacheSizeForTest(): number {
  return cronEvalCache.size;
}
