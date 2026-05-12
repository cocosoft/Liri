import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  burstMax?: number;
  burstWindowMs?: number;
}

export interface RateLimitBucket {
  count: number;
  windowStart: number;
  burstCount: number;
  burstWindowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterMs: number;
  totalLimit: number;
}

const DEFAULT_BURST_MULTIPLIER = 2;
const DEFAULT_BURST_WINDOW_MS = 1_000;

export class RateLimiter {
  readonly name = 'RateLimiter';
  private buckets: Map<string, RateLimitBucket> = new Map();
  private globalBuckets: Map<string, RateLimitBucket> = new Map();
  private configs: Map<string, Required<RateLimitConfig>> = new Map();
  private defaultConfig: Required<RateLimitConfig>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(defaultConfig?: Partial<RateLimitConfig>) {
    this.defaultConfig = {
      windowMs: defaultConfig?.windowMs ?? 60_000,
      maxRequests: defaultConfig?.maxRequests ?? 60,
      burstMax:
        defaultConfig?.burstMax ??
        (defaultConfig?.maxRequests ?? 60) * DEFAULT_BURST_MULTIPLIER,
      burstWindowMs: defaultConfig?.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS,
    };
  }

  setConfig(key: string, config: Partial<RateLimitConfig>): void {
    const base = this.configs.get(key) ?? this.defaultConfig;
    this.configs.set(key, {
      windowMs: config.windowMs ?? base.windowMs,
      maxRequests: config.maxRequests ?? base.maxRequests,
      burstMax:
        config.burstMax ??
        (config.maxRequests ?? base.maxRequests) * DEFAULT_BURST_MULTIPLIER,
      burstWindowMs: config.burstWindowMs ?? base.burstWindowMs,
    });
  }

  getConfig(key: string): Required<RateLimitConfig> {
    return this.configs.get(key) ?? this.defaultConfig;
  }

  check(key: string, weight: number = 1): RateLimitResult {
    const config = this.getConfig(key);
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= config.windowMs) {
      bucket = {
        count: 0,
        windowStart: now,
        burstCount: 0,
        burstWindowStart: now,
      };
      this.buckets.set(key, bucket);
    }

    let globalBucket = this.globalBuckets.get(key);
    if (!globalBucket || now - globalBucket.windowStart >= config.windowMs) {
      globalBucket = {
        count: 0,
        windowStart: now,
        burstCount: 0,
        burstWindowStart: now,
      };
      this.globalBuckets.set(key, globalBucket);
    }

    if (now - bucket.burstWindowStart >= config.burstWindowMs) {
      bucket.burstCount = 0;
      bucket.burstWindowStart = now;
    }

    const newCount = bucket.count + weight;
    const newBurstCount = bucket.burstCount + weight;
    const globalNewCount = globalBucket.count + weight;

    if (newCount > config.maxRequests || globalNewCount > config.maxRequests) {
      const resetMs = config.windowMs - (now - bucket.windowStart);
      return {
        allowed: false,
        remaining: 0,
        resetMs,
        retryAfterMs: resetMs,
        totalLimit: config.maxRequests,
      };
    }

    if (newBurstCount > config.burstMax) {
      const resetMs = config.burstWindowMs - (now - bucket.burstWindowStart);
      return {
        allowed: false,
        remaining: 0,
        resetMs,
        retryAfterMs: resetMs,
        totalLimit: config.burstMax,
      };
    }

    bucket.count = newCount;
    bucket.burstCount = newBurstCount;
    globalBucket.count = globalNewCount;

    return {
      allowed: true,
      remaining: config.maxRequests - newCount,
      resetMs: config.windowMs - (now - bucket.windowStart),
      retryAfterMs: 0,
      totalLimit: config.maxRequests,
    };
  }

  checkGlobal(key: string, weight: number = 1): RateLimitResult {
    return this.check(`global:${key}`, weight);
  }

  reset(key: string): void {
    this.buckets.delete(key);
    this.globalBuckets.delete(key);
  }

  resetAll(): void {
    this.buckets.clear();
    this.globalBuckets.clear();
  }

  getActiveKeys(): string[] {
    return Array.from(this.buckets.keys());
  }

  getActiveGlobalKeys(): string[] {
    return Array.from(this.globalBuckets.keys());
  }

  getBucketInfo(key: string): RateLimitBucket | undefined {
    const bucket = this.buckets.get(key);
    if (!bucket) return undefined;
    const now = Date.now();
    if (now - bucket.windowStart >= this.getConfig(key).windowMs) {
      this.buckets.delete(key);
      return undefined;
    }
    return { ...bucket };
  }

  startCleanup(intervalMs: number = 300_000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, bucket] of this.buckets) {
      const config = this.getConfig(key);
      if (now - bucket.windowStart >= config.windowMs) {
        this.buckets.delete(key);
        removedCount++;
      }
    }

    for (const [key, bucket] of this.globalBuckets) {
      const config = this.getConfig(key);
      if (now - bucket.windowStart >= config.windowMs) {
        this.globalBuckets.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug(`RateLimiter: 已清理 ${removedCount} 个过期桶`);
    }
  }
}
