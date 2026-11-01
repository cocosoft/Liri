//
/**
 * 增强的Cron抖动配置
 * 参考CC源码: cc_code/backend/utils/cronJitterConfig.ts
 */

import type { CronJitterConfig } from './types';

/**
 * 默认抖动配置
 */
export const DEFAULT_CRON_JITTER_CONFIG: CronJitterConfig = {
  recurringJitterMs: 60_000,
  recurringMaxAgeMs: 14 * 24 * 60 * 60 * 1000,
  oneShotMaxMs: 30 * 60 * 1000,
  oneShotFloorMs: 0,
  oneShotMinuteMod: 1,
  recurringCapMs: 30 * 60 * 1000,
  recurringFrac: 0.1,
};

/**
 * 获取一次性任务的抖动时间
 * 一次性任务提前执行，避免延迟
 * @param baseMs 基准时间（毫秒）
 * @param config 抖动配置
 * @returns 抖动后的时间戳
 */
export function oneShotJitteredNextCronRunMs(
  baseMs: number,
  config: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG
): number {
  const { oneShotMaxMs, oneShotFloorMs, oneShotMinuteMod } = config;

  const maxJitter = oneShotMaxMs || 0;
  const floorJitter = oneShotFloorMs || 0;
  const minuteMod = oneShotMinuteMod || 1;

  if (maxJitter === 0) {
    return baseMs;
  }

  const jitterRange = maxJitter - floorJitter;
  const randomJitter = Math.floor(Math.random() * jitterRange) + floorJitter;

  const jitteredTime = baseMs - randomJitter;

  if (minuteMod > 1) {
    const minuteMs = 60 * 1000;
    const modMs = minuteMod * minuteMs;
    const remainder = jitteredTime % modMs;
    return jitteredTime - remainder;
  }

  return jitteredTime;
}

/**
 * 获取周期性任务的抖动时间
 * 周期性任务延迟执行，避免系统负载峰值
 * @param baseMs 基准时间（毫秒）
 * @param config 抖动配置
 * @returns 抖动后的时间戳
 */
export function recurringJitteredNextCronRunMs(
  baseMs: number,
  config: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG
): number {
  const { recurringFrac, recurringCapMs, recurringJitterMs } = config;

  if (recurringFrac && recurringCapMs) {
    const fracJitter = baseMs * recurringFrac;
    const jitter = Math.min(fracJitter, recurringCapMs);
    const randomFactor = Math.random();
    return baseMs + Math.floor(jitter * randomFactor);
  }

  if (recurringJitterMs) {
    const jitter = Math.floor(Math.random() * recurringJitterMs);
    return baseMs + jitter;
  }

  return baseMs;
}

export function isRecurringTaskExpired(
  taskCreatedAt: number,
  config: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG
): boolean {
  const { recurringMaxAgeMs } = config;
  if (!recurringMaxAgeMs || recurringMaxAgeMs === 0) {
    return false;
  }
  const now = Date.now();
  return now - taskCreatedAt > recurringMaxAgeMs;
}

/**
 * 检查任务是否过期
 * @param createdAt 任务创建时间点
 * @param isRecurring 是否为周期性任务
 * @param isPermanent 是否为永久任务
 * @returns 是否过期
 */
export function isTaskExpired(
  createdAt: number,
  isRecurring: boolean,
  isPermanent: boolean
): boolean {
  if (!isRecurring || isPermanent) {
    return false;
  }
  const { recurringMaxAgeMs } = DEFAULT_CRON_JITTER_CONFIG;
  if (!recurringMaxAgeMs || recurringMaxAgeMs === 0) {
    return false;
  }
  return Date.now() - createdAt >= recurringMaxAgeMs;
}

/**
 * 计算抖动后的下次运行时间
 * @param cron cron表达式
 * @param baseMs 基准时间（毫秒）
 * @param isOneShot 是否为一次性任务
 * @param config 抖动配置
 * @returns 抖动后的时间戳或null
 */
export function jitteredNextCronRunMs(
  cron: string,
  baseMs: number,
  isOneShot: boolean = false,
  config: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG
): number | null {
  const {
    parseCronExpression,
    computeNextCronRun,
    normalizeSchedule,
  } = require('./cron');
  const normalized = normalizeSchedule
    ? (normalizeSchedule(cron) ?? cron)
    : cron;
  const fields = parseCronExpression(normalized);
  if (!fields) return null;

  const nextRun = computeNextCronRun(fields, new Date(baseMs));
  if (!nextRun) return null;

  const nextRunMs = nextRun.getTime();

  if (isOneShot) {
    return oneShotJitteredNextCronRunMs(nextRunMs, config);
  }

  return recurringJitteredNextCronRunMs(nextRunMs, config);
}

/**
 * 获取当前抖动配置
 */
let currentJitterConfig: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG;

export function getJitterConfig(): CronJitterConfig {
  return currentJitterConfig;
}

export function setJitterConfig(config: Partial<CronJitterConfig>): void {
  currentJitterConfig = { ...currentJitterConfig, ...config };
}

export function resetJitterConfig(): void {
  currentJitterConfig = DEFAULT_CRON_JITTER_CONFIG;
}

/**
 * 验证抖动配置
 * @param config 配置对象
 * @returns 是否有效
 */
export function validateJitterConfig(
  config: unknown
): config is CronJitterConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const c = config as Record<string, unknown>;

  if (typeof c.recurringJitterMs !== 'number' || c.recurringJitterMs < 0) {
    return false;
  }

  if (typeof c.recurringMaxAgeMs !== 'number' || c.recurringMaxAgeMs < 0) {
    return false;
  }

  if (
    c.oneShotMaxMs !== undefined &&
    (typeof c.oneShotMaxMs !== 'number' || c.oneShotMaxMs < 0)
  ) {
    return false;
  }

  if (
    c.oneShotFloorMs !== undefined &&
    (typeof c.oneShotFloorMs !== 'number' || c.oneShotFloorMs < 0)
  ) {
    return false;
  }

  if (c.oneShotFloorMs !== undefined && c.oneShotMaxMs !== undefined) {
    if (c.oneShotFloorMs > c.oneShotMaxMs) {
      return false;
    }
  }

  return true;
}
