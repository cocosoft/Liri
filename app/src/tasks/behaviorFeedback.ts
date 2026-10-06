// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 行为反馈回流（13-P2-2，2026-10-05）—— 把**任务结果率**回灌到 PDL 的路径选择
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A2「评估指标不回流」——
 * 测量（`evals/`）→ 决策（任务分解/路径）之间**没有通路**；报告建议的最小回流点为
 * 「连续 N 次任务失败率偏高 ⇒ 调整该任务类型的分解粒度」。
 *
 * ⚠️ 与 `BehaviorMetrics` 的边界（如实 · 刻意）：
 * `evals/types.ts` 的 `BehaviorMetrics` 三字段（自验证/探索/草稿比）被**显式契约**定为
 * 「仅观测、不作门禁」（`behaviorMetrics.ts:22-27` / `types.ts:200-204,238`，且有**反向锁定测试**）
 * —— exploration / drafting 的置信区间跨 0（统计不显著）。**本模块不消费那三个字段**（不违背该契约），
 * 而是回流**任务结果**（成功/失败，等价于报告所举的 `checkPassRate` 信号）。
 *
 * 边界（如实 · CS03）：
 * - **内存滚动窗口**，不落盘、不入 DB ⇒ 进程内有效（跨重启需另行接入持久层；本轮不新增表/列）。
 * - 仅在**有足够样本**时给判据（`sampleCount < minSamples` ⇒ 不干预）—— 避免用 1 次失败翻转策略。
 */

/**
 * 路径形态（PDL 的执行路径，作为回流的**分桶键**，CS02：结构化枚举非用户文案）
 * - `simple`：复杂度门判定为简单 ⇒ 快速直执行（**升级判据作用于此桶**）
 * - `decomposed`：走分解 + 逐步执行
 * - `direct`：分解未产出/失败 ⇒ 降级直执行（与 `simple` 分桶隔离，避免污染快速路径信号）
 */
export type PlanPathKind = 'simple' | 'decomposed' | 'direct';

/** 单条任务结果样本 */
export interface TaskOutcomeSample {
  path: PlanPathKind;
  success: boolean;
  ts: number;
}

/** 某分桶的滚动信号 */
export interface OutcomeSignal {
  sampleCount: number;
  failureRate: number;
}

export const DEFAULT_OUTCOME_WINDOW = 20;
export const DEFAULT_ESCALATE_MIN_SAMPLES = 3;
export const DEFAULT_ESCALATE_FAILURE_RATE = 0.5;

/**
 * 按分桶键维护**最近 N 条**任务结果的滚动窗口（内存）。
 */
export class TaskOutcomeLedger {
  private readonly windowSize: number;
  private readonly samples = new Map<string, TaskOutcomeSample[]>();

  constructor(windowSize: number = DEFAULT_OUTCOME_WINDOW) {
    this.windowSize =
      Number.isFinite(windowSize) && windowSize > 0
        ? Math.floor(windowSize)
        : DEFAULT_OUTCOME_WINDOW;
  }

  record(
    key: string,
    sample: { path: PlanPathKind; success: boolean; ts?: number }
  ): void {
    const list = this.samples.get(key) ?? [];
    list.push({
      path: sample.path,
      success: sample.success,
      ts: sample.ts ?? Date.now(),
    });
    if (list.length > this.windowSize) {
      list.splice(0, list.length - this.windowSize);
    }
    this.samples.set(key, list);
  }

  /** 某分桶的信号；**无样本 ⇒ `undefined`**（调用方据此不干预） */
  signal(key: string): OutcomeSignal | undefined {
    const list = this.samples.get(key);
    if (!list || list.length === 0) return undefined;
    const failures = list.filter((s) => !s.success).length;
    return { sampleCount: list.length, failureRate: failures / list.length };
  }

  clear(): void {
    this.samples.clear();
  }
}

/** 回流判据（纯函数）：样本足够且失败率达标 ⇒ 应把简单路径升级为更细粒度的分解路径 */
export function shouldEscalateGranularity(
  signal: OutcomeSignal | undefined,
  opts: {
    minSamples?: number;
    failureRate?: number;
  } = {}
): boolean {
  if (!signal) return false;
  const minSamples = opts.minSamples ?? DEFAULT_ESCALATE_MIN_SAMPLES;
  const threshold = opts.failureRate ?? DEFAULT_ESCALATE_FAILURE_RATE;
  return signal.sampleCount >= minSamples && signal.failureRate >= threshold;
}

let globalLedger: TaskOutcomeLedger | null = null;

/** 全局账本（唯一实例；PDL 缺省复用，组合根亦可在 config 注入独立实例） */
export function getTaskOutcomeLedger(): TaskOutcomeLedger {
  if (!globalLedger) globalLedger = new TaskOutcomeLedger();
  return globalLedger;
}

/** 测试用：重置全局账本（对齐既有 `reset*ForTest` 约定） */
export function resetTaskOutcomeLedgerForTest(): void {
  globalLedger = null;
}
