/**
 * AlwaysOnQuota — 按**归属**（租户/用户）的自主运行配额（多租户 P3）
 *
 * 背景：`DiscoveryGates.dailyBudget` 是**每项目**的内存计数 ⇒ 同一租户有 N 个项目就得到
 * N × budget 次自主运行，且不同租户之间没有任何隔离（一个租户的多项目可把进程占满）。
 *
 * 本类把"租户维度"补上：配额按 `ownerKey` 共享与限流，跨该归属的所有项目生效。
 *   - `dailyRunsPerOwner`：每归属每天允许的自主运行次数；
 *   - `maxConcurrentPerOwner`：每归属同时在跑的运行数。
 *
 * 三处口径（与 P1/P2/P3 同一条 fail-closed 原则）：
 *   1. **本地身份不参与** —— 项目没有 `ownerKey`（桌面 / CLI / 后台）时，运行时根本不查本类
 *      ⇒ 行为与改造前逐字相同；
 *   2. **计数在"开始执行"时点**（门控与排空检查之后）—— 被门控拦下的 tick 不消耗租户配额；
 *   3. **跨天惰性重置** —— 仅在访问该归属时比对本地日期，不依赖定时器。
 */
import { cg3Log } from '../cg3Env';

export interface AlwaysOnQuotaConfig {
  /** 每归属每天允许的自主运行次数（跨该归属的所有项目共享） */
  dailyRunsPerOwner: number;
  /** 每归属同时进行的自主运行数上限 */
  maxConcurrentPerOwner: number;
}

export const DEFAULT_ALWAYSON_QUOTA: AlwaysOnQuotaConfig = {
  dailyRunsPerOwner: 8,
  maxConcurrentPerOwner: 1,
};

/** 拒绝原因（与 `GateReason` 分开：这是**归属配额**，不是项目门控） */
export type OwnerQuotaDenial = 'daily_quota' | 'concurrent_quota';

export interface OwnerQuotaDecision {
  allowed: boolean;
  reason?: OwnerQuotaDenial;
}

interface OwnerUsage {
  /** 记录所属的本地日期（跨天即清零） */
  day: string;
  runsToday: number;
  running: number;
}

export class AlwaysOnQuota {
  private readonly config: AlwaysOnQuotaConfig;
  private readonly usage = new Map<string, OwnerUsage>();
  private readonly now: () => number;

  constructor(
    config: Partial<AlwaysOnQuotaConfig> = {},
    now: () => number = Date.now
  ) {
    this.config = { ...DEFAULT_ALWAYSON_QUOTA, ...config };
    this.now = now;
  }

  /**
   * 尝试占用一次运行配额（同时计数"今日已运行"与"正在运行"）。
   * 拒绝时不改变任何计数 —— 调用方无需回滚。
   */
  tryAcquire(ownerKey: string): OwnerQuotaDecision {
    const entry = this.entryOf(ownerKey);
    if (entry.runsToday >= this.config.dailyRunsPerOwner) {
      return { allowed: false, reason: 'daily_quota' };
    }
    if (entry.running >= this.config.maxConcurrentPerOwner) {
      return { allowed: false, reason: 'concurrent_quota' };
    }
    entry.runsToday += 1;
    entry.running += 1;
    return { allowed: true };
  }

  /** 运行结束后释放并发位（今日计数保留） */
  release(ownerKey: string): void {
    const entry = this.usage.get(ownerKey);
    if (!entry) return;
    entry.running = Math.max(0, entry.running - 1);
  }

  /** 只读快照（含跨天重置），用于日志与白盒测试 */
  usageOf(ownerKey: string): { runsToday: number; running: number } {
    const entry = this.entryOf(ownerKey);
    return { runsToday: entry.runsToday, running: entry.running };
  }

  /** 清空全部计数（测试隔离用；生产路径不需要） */
  reset(): void {
    this.usage.clear();
  }

  /** 取该归属的计数条目，跨天则清零（惰性，无定时器） */
  private entryOf(ownerKey: string): OwnerUsage {
    const day = new Date(this.now()).toDateString();
    const existing = this.usage.get(ownerKey);
    if (existing && existing.day === day) return existing;
    const fresh: OwnerUsage = { day, runsToday: 0, running: 0 };
    this.usage.set(ownerKey, fresh);
    if (existing) {
      cg3Log('tasks:alwayson:quota', 'debug', 'dayRollover', { ownerKey });
    }
    return fresh;
  }
}
