/**
 * ProcessWatchdog — 后台进程看门狗
 *
 * P2-8: 对标 hermes-agent process_registry 的看门狗机制。
 * 通过正则匹配子进程 stdout/stderr，检测预定义异常模式并触发告警。
 *
 * 特性：
 *   - 正则模式匹配（含速率限制）
 *   - 全局断路器（连续告警超过阈值后自动静默）
 *   - 回调通知
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'daemon:watchdog' });

// ==========================================
// Types
// ==========================================

export interface WatchPattern {
  name: string;
  pattern: RegExp;
  severity: 'info' | 'warn' | 'error';
  rateLimitMs?: number; // 同一模式最小通知间隔
  description: string;
}

export interface WatchdogConfig {
  patterns: WatchPattern[];
  globalCircuitBreaker: number; // 全局断路器阈值
  circuitWindowMs: number; // 断路器时间窗口
}

export interface WatchdogStats {
  totalMatches: number;
  activeAlerts: number;
  circuitOpen: boolean;
  patternHits: Record<string, number>;
}

// ==========================================
// Default Patterns
// ==========================================

const DEFAULT_PATTERNS: WatchPattern[] = [
  {
    name: 'oom_kill',
    pattern: /out of memory|OOM killer|Cannot allocate memory/i,
    severity: 'error',
    rateLimitMs: 60_000,
    description: 'Out-of-memory kill detected',
  },
  {
    name: 'disk_full',
    pattern: /No space left on device|disk quota exceeded/i,
    severity: 'error',
    rateLimitMs: 60_000,
    description: 'Disk full error',
  },
  {
    name: 'auth_failure',
    pattern:
      /401 Unauthorized|403 Forbidden|Invalid API key|Authentication failed/i,
    severity: 'error',
    rateLimitMs: 30_000,
    description: 'Authentication failure',
  },
  {
    name: 'rate_limit',
    pattern: /429 Too Many Requests|rate limit exceeded|quota exceeded/i,
    severity: 'warn',
    rateLimitMs: 30_000,
    description: 'API rate limit hit',
  },
  {
    name: 'connection_failure',
    pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection reset/i,
    severity: 'warn',
    rateLimitMs: 30_000,
    description: 'Network connection failure',
  },
];

// ==========================================
// Watchdog
// ==========================================

export class ProcessWatchdog {
  private patterns: WatchPattern[];
  private lastFireTimes = new Map<string, number>();
  private patternHits: Record<string, number> = {};
  private alertCount = 0;
  private circuitOpen = false;
  private circuitOpenedAt = 0;
  private readonly globalMax: number;
  private readonly circuitWindowMs: number;

  constructor(config?: Partial<WatchdogConfig>) {
    this.patterns = config?.patterns ?? DEFAULT_PATTERNS;
    this.globalMax = config?.globalCircuitBreaker ?? 50;
    this.circuitWindowMs = config?.circuitWindowMs ?? 300_000;
    for (const p of this.patterns) {
      this.patternHits[p.name] = 0;
    }
  }

  /**
   * 喂入一行进程输出，检测预定义异常模式
   */
  feed(line: string): Array<{ pattern: string; severity: string }> {
    if (this.circuitOpen) {
      if (Date.now() - this.circuitOpenedAt > this.circuitWindowMs) {
        this.circuitOpen = false;
        this.alertCount = 0;
        logger.info('watchdog:circuit_closed');
      } else {
        return [];
      }
    }

    const matches: Array<{ pattern: string; severity: string }> = [];

    for (const p of this.patterns) {
      if (!p.pattern.test(line)) continue;

      // Rate limit check
      const lastFire = this.lastFireTimes.get(p.name) ?? 0;
      const rateLimit = p.rateLimitMs ?? 10_000;
      if (Date.now() - lastFire < rateLimit) continue;

      this.lastFireTimes.set(p.name, Date.now());
      this.patternHits[p.name] = (this.patternHits[p.name] ?? 0) + 1;
      this.alertCount++;

      matches.push({ pattern: p.name, severity: p.severity });

      logger[p.severity === 'error' ? 'error' : 'warn'](`watchdog:${p.name}`, {
        description: p.description,
        line: line.slice(0, 200),
      });
    }

    // Global circuit breaker
    if (this.alertCount >= this.globalMax) {
      this.circuitOpen = true;
      this.circuitOpenedAt = Date.now();
      logger.error('watchdog:circuit_opened', {
        alertCount: this.alertCount,
        globalMax: this.globalMax,
        circuitWindowMs: this.circuitWindowMs,
      });
    }

    return matches;
  }

  /** 获取统计 */
  getStats(): WatchdogStats {
    return {
      totalMatches: this.alertCount,
      activeAlerts: Object.values(this.patternHits).reduce((a, b) => a + b, 0),
      circuitOpen: this.circuitOpen,
      patternHits: { ...this.patternHits },
    };
  }

  /** 重置统计 */
  reset(): void {
    this.lastFireTimes.clear();
    for (const p of this.patterns) this.patternHits[p.name] = 0;
    this.alertCount = 0;
    this.circuitOpen = false;
  }
}
