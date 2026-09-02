/**
 * 内存水位监测器（2026-09-02，OS kswapd 式水位机制，详见
 * dev_docs/内存水位触发机制-详细设计-20260902.md）
 *
 * 背景：实测"上下文 ≤23K tokens 仍 RSS 3.6GB / heapTotal 1.4GB / heapUsed 1GB"
 * ——内存压力与上下文体积解耦，token-% 触发看不到内存压力。本模块在既有
 * token-% 触发之外，按**实测内存水位**（rss/heapTotal/事件循环滞后）判定
 * L0/L1/L2 并驱动分级回收：
 *   - L0 (soft1)：脏页写回(flush 会话缓冲) + 非关键后台任务暂停
 *   - L1 (soft2)：后台摘要调度（缩小下一轮工作集 / 收紧分层窗口）
 *   - L2 (hard) ：前台回收 + 并发节流（沿用既有 45K 分层压缩路径）
 *
 * 镜像 OS 语义：
 *   - 水位预警先行（请求/工具轮边界 tick，非 60s 采样滞后）
 *   - 分级回收先廉价(无损)后昂贵(有损)
 *   - 防抖（同级别 30s 冷却）+ 升级（回收后仍超 → 升一级）
 *   - 反向扩张（session_lookup 命中率/重复压缩率升高 → 放宽窗口，thrashing 防护）
 *
 * 开关/参数（env）：
 *   MEM_PRESSURE=0          全局关闭
 *   MEM_PRESSURE_SOFT1_MB / SOFT2_MB / HARD_MB   默认 2400/3000/4000（相对基线的
 *                                                绝对下限，防止低内存机误判）
 *   MEM_PRESSURE_LAG_MS      事件循环滞后阈值（默认 2000）
 *   MEM_PRESSURE_COOLDOWN_MS 同级别冷却（默认 30_000）
 *   MEM_PRESSURE_RECOVER_MB  回落判定缓冲（默认 512）
 */
import { Logger } from '@modules/monitoring/logs/Logger.js';
import { LogLevel } from '@modules/monitoring';

const ENABLED = process.env.MEM_PRESSURE !== '0';

const SOFT1_MB = Number(process.env.MEM_PRESSURE_SOFT1_MB ?? 2400);
const SOFT2_MB = Number(process.env.MEM_PRESSURE_SOFT2_MB ?? 3000);
const HARD_MB = Number(process.env.MEM_PRESSURE_HARD_MB ?? 4000);
const LAG_MS = Number(process.env.MEM_PRESSURE_LAG_MS ?? 2000);
const COOLDOWN_MS = Number(process.env.MEM_PRESSURE_COOLDOWN_MS ?? 30_000);
const RECOVER_MB = Number(process.env.MEM_PRESSURE_RECOVER_MB ?? 512);

/** 分层窗口收紧量（L1 压力下把默认 45K 窗口收紧到 32K，缩小下一轮工作集） */
export const PRESSURE_LAYER_WINDOW_OVERRIDE = 32_000;

/** 压力级别：0=正常；1=L0(soft1)；2=L1(soft2)；3=L2(hard) */
export type PressureLevel = 0 | 1 | 2 | 3;

interface Sample {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
}

export interface PressureSnapshot {
  level: PressureLevel;
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  baselineRssMb: number;
  lagMs: number;
  reason?: string;
}

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'memory:pressure',
});

class MemoryPressureMonitor {
  private baselineRssMb = 0;
  private baselineSamples: number[] = [];
  private baselineDone = false;
  private level: PressureLevel = 0;
  private lastActionAt: Record<PressureLevel, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
  };
  private recoverSince = 0;
  private lastRssMb = 0;
  private readonly listeners = new Set<(level: PressureLevel) => void>();

  // 可观测计数
  private counters = {
    trigger: 0,
    escalate: 0,
    recover: 0,
    reverseWindow: 0,
    flushAction: 0,
    pauseAction: 0,
  };

  /**
   * 订阅分级动作（订阅方如 ChatManager L0→flush、后台任务→暂停）。
   * 仅当发生"进入更高级别"时通知（0 级不通知）。
   */
  subscribe(fn: (level: PressureLevel) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getCounters(): Readonly<typeof this.counters> {
    return this.counters;
  }

  isUnderPressure(): boolean {
    return this.level >= 1;
  }

  currentLevel(): PressureLevel {
    return this.level;
  }

  /**
   * 分层窗口生效值：L1+ 压力下收紧（供 ReActToolLoop 读取，
   * 替代固定的 REACT_LAYER_WINDOW_TOKENS，缩小压力期工作集）。
   */
  effectiveLayerWindow(defaultWindow: number): number {
    return this.level >= 2
      ? Math.min(defaultWindow, PRESSURE_LAYER_WINDOW_OVERRIDE)
      : defaultWindow;
  }

  /**
   * 由请求/工具轮边界调用（轻量：一次 memoryUsage + 事件循环滞后探测）。
   * 只在"级别变化/冷却期满"时打日志与通知，正常路径零日志。
   */
  tick(lagMs = 0): void {
    if (!ENABLED) return;
    const m = process.memoryUsage();
    this.feed(
      {
        rssMb: m.rss / 1048576,
        heapUsedMb: m.heapUsed / 1048576,
        heapTotalMb: m.heapTotal / 1048576,
      },
      lagMs
    );
  }

  /** 喂入样本（测试可直接调用；生产走 tick）。lagMs=0 表示未观测到滞后。 */
  feed(sample: Sample, lagMs = 0): PressureSnapshot {
    const rssMb = sample.rssMb;
    this.lastRssMb = rssMb;
    this.learnBaseline(sample);
    const snap = this.assess(rssMb, sample, lagMs);
    this.maybePublish(snap);
    return snap;
  }

  private learnBaseline(sample: Sample): void {
    if (this.baselineDone) return;
    // 取启动后前 12 个采样的低水位 min 作为空闲基线（本机实测 ~1.33-1.43GB）
    this.baselineSamples.push(sample.rssMb);
    if (this.baselineSamples.length >= 12) {
      this.baselineRssMb = Math.min(...this.baselineSamples);
      this.baselineDone = true;
      logger.info('memory:pressure 基线已学习', {
        baselineRssMb: Math.round(this.baselineRssMb),
        samples: this.baselineSamples.length,
      });
    }
  }

  private assess(
    rssMb: number,
    sample: Sample,
    lagMs: number
  ): PressureSnapshot {
    const base = this.baselineRssMb || rssMb;
    const hard = Math.max(base + 2400, HARD_MB);
    const soft2 = Math.max(base + 1600, SOFT2_MB);
    const soft1 = Math.max(base + 1000, SOFT1_MB);
    const hardLag = lagMs >= 5000;

    let level: PressureLevel = 0;
    let reason: string | undefined;
    if (rssMb > hard || hardLag) {
      level = 3;
      reason = hardLag
        ? `lag=${lagMs}ms(≥5000)`
        : `rss=${rssMb.toFixed(0)}>${Math.round(hard)}`;
    } else if (rssMb > soft2) {
      level = 2;
      reason = `rss=${rssMb.toFixed(0)}>${Math.round(soft2)}`;
    } else if (rssMb > soft1) {
      level = 1;
      reason = `rss=${rssMb.toFixed(0)}>${Math.round(soft1)}`;
    }

    // 事件循环滞后（非 hard）视为 L1(soft2) 压力迹象（GC 全堆回收中）
    if (level < 2 && lagMs > 0 && lagMs >= LAG_MS && rssMb > soft1) {
      level = 2;
      reason = `lag=${lagMs}ms(≥${LAG_MS}) 且 rss 已超 soft1`;
    }

    return {
      level,
      rssMb,
      heapTotalMb: sample.heapTotalMb,
      heapUsedMb: sample.heapUsedMb,
      baselineRssMb: base,
      lagMs,
      reason,
    };
  }

  private maybePublish(snap: PressureSnapshot): void {
    const now = Date.now();
    const { level } = snap;

    if (level === 0) {
      // 恢复：低于 soft1-缓冲且稳定（连续恢复窗口）→ 降级并通知
      const recoverBelow = snap.baselineRssMb + 1000 - RECOVER_MB;
      if (this.level > 0 && snap.rssMb < recoverBelow) {
        if (this.recoverSince === 0) this.recoverSince = now;
        if (now - this.recoverSince >= 60_000) {
          this.counters.recover++;
          logger.info('memory:pressure 水位恢复', {
            fromLevel: this.level,
            rssMb: Math.round(snap.rssMb),
            baselineRssMb: Math.round(snap.baselineRssMb),
          });
          this.level = 0;
          this.recoverSince = 0;
        }
      } else {
        this.recoverSince = 0;
      }
      return;
    }

    // 进入更高级别或冷却期满可重复通知
    if (
      level > this.level ||
      (level === this.level && now - this.lastActionAt[level] >= COOLDOWN_MS)
    ) {
      const escalated = level > this.level;
      this.level = level;
      this.lastActionAt[level] = now;
      this.counters.trigger++;
      if (escalated) this.counters.escalate++;
      logger.warn('memory:pressure 水位触发', {
        level,
        rssMb: Math.round(snap.rssMb),
        heapTotalMb: Math.round(snap.heapTotalMb),
        heapUsedMb: Math.round(snap.heapUsedMb),
        lagMs: snap.lagMs,
        baselineRssMb: Math.round(snap.baselineRssMb),
        reason: snap.reason,
      });
      for (const fn of this.listeners) {
        try {
          fn(level);
        } catch {
          // @ignore-catch — 订阅者动作失败不阻断监测（CS03）
        }
      }
    }
  }

  /** 反向扩张指标：外部上报（session_lookup 命中率升高 / 同会话短时重复压缩） */
  recordReverseSignal(_sessionId: string, reason: string): void {
    if (!ENABLED) return;
    // 阈值内不做动作，仅计数 + 日志，供后续放宽窗口策略（首版记录，不做自动放宽
    // ——放宽会改变有损边界，需对照验证后启用）。
    this.counters.reverseWindow++;
    logger.warn('memory:pressure 反向信号（窗口可能过小，记录待评估）', {
      reason,
      reverseWindowCount: this.counters.reverseWindow,
    });
  }
}

/** 单例（对齐 getLogger/getToolRegistry 风格） */
let instance: MemoryPressureMonitor | null = null;
export function getMemoryPressureMonitor(): MemoryPressureMonitor {
  if (!instance) instance = new MemoryPressureMonitor();
  return instance;
}

/** 便捷读取：是否处于压力中（后台任务暂停/节流用） */
export function isMemoryUnderPressure(): boolean {
  return getMemoryPressureMonitor().isUnderPressure();
}

/** 测试用：重置单例（隔离用例状态；生产勿调） */
export function resetMemoryPressureMonitorForTest(): void {
  instance = null;
}
