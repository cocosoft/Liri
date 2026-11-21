// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 按 agent 的**任务结果事实源**（2026-11-21，`agent-load-routing.md` §7 第 2 项）
 *
 * 目的：为「置信度路由」提供**可判定**的输入 —— 某注册表 agent 在**同类任务**上的历史成功率。
 * 现状（未做时）：`TaskOutcomeLedger` 只按 PDL 路径分桶、无 agent 归属；PDCA `review_samples`
 * 也不带 registry `agentId` ⇒ 之前无法按 agent 聚合（"未做即不打分，不猜"）。
 *
 * 三条边界（如实）：
 * 1. **只在有归属时记录**：仅 `AgentRunView.registryAgentId` 存在（来源 = 运行时注册表）才落样本；
 *    内置类型 / 无归属 run **不记录**（不用类型名冒充 agent 维度）。
 * 2. **只在唯一结算点记录**：`AgentLedgerLifecycle.settleRun` 的副作用认领闸门之后
 *    （`claimTerminalSideEffects` 幂等）⇒ 同一次 run 不会重复计数。
 * 3. **本模块只提供事实，不做路由决策**：`signal()` 的消费（打分/选人）仍属未接线项，
 *    没有真实样本时调用方拿到的就是 `undefined`。
 *
 * 与 `TaskOutcomeLedger` 的分工（CS01：不复用同一实例）：后者是"路径粒度 → 是否升级分解"的
 * 反馈回流；本模块是"agent × 任务类型粒度 → 历史成功率"的置信度事实源，键空间与语义都不同。
 */

/** 单条样本（`taskKind` 取运行 `type`，与 `AgentRunView.type` 同口径） */
export interface AgentOutcomeSample {
  success: boolean;
  ts: number;
}

/** 某 (agent, taskKind) 分桶的滚动信号 */
export interface AgentOutcomeSignal {
  sampleCount: number;
  /** 0..1；**无样本时不返回该对象**（调用方据此不打分） */
  successRate: number;
}

/** 每个分桶保留的最近样本数（与 `TaskOutcomeLedger` 默认窗口一致） */
export const DEFAULT_AGENT_OUTCOME_WINDOW = 20;
/** 分桶上限（LRU：超出后淘汰最早建立的桶，防长跑内存增长） */
export const DEFAULT_AGENT_OUTCOME_MAX_KEYS = 200;

/** 分桶键：`agentId \u0000 taskKind`（避免两字段拼接歧义） */
function bucketKey(agentId: string, taskKind: string): string {
  return `${agentId}\u0000${taskKind}`;
}

/**
 * 有界的 agent × 任务类型结果台账（内存滚动窗口）。
 *
 * 不落盘（与 `TaskOutcomeLedger` 同口径）：跨重启归零，不伪造历史。
 */
export class AgentOutcomeLedger {
  private readonly windowSize: number;
  private readonly maxKeys: number;
  /** 键 → 最近 N 条样本（Map 插入序即 LRU 依据） */
  private readonly buckets = new Map<string, AgentOutcomeSample[]>();

  constructor(
    windowSize: number = DEFAULT_AGENT_OUTCOME_WINDOW,
    maxKeys: number = DEFAULT_AGENT_OUTCOME_MAX_KEYS
  ) {
    this.windowSize =
      Number.isFinite(windowSize) && windowSize > 0
        ? Math.floor(windowSize)
        : DEFAULT_AGENT_OUTCOME_WINDOW;
    this.maxKeys =
      Number.isFinite(maxKeys) && maxKeys > 0
        ? Math.floor(maxKeys)
        : DEFAULT_AGENT_OUTCOME_MAX_KEYS;
  }

  /**
   * 记录一次任务结果。
   *
   * @param agentId 注册表稳定 agentId（**不是**运行 id）
   * @param taskKind 任务类型（`AgentRunView.type`）
   */
  record(
    agentId: string,
    taskKind: string,
    success: boolean,
    ts: number = Date.now()
  ): void {
    if (!agentId || !taskKind) return; // 无归属不记录（不冒充）
    const key = bucketKey(agentId, taskKind);
    const list = this.buckets.get(key) ?? [];
    list.push({ success, ts });
    if (list.length > this.windowSize) {
      list.splice(0, list.length - this.windowSize);
    }
    this.buckets.set(key, list);
    this.evictIfNeeded();
  }

  /** 某分桶的信号；**无样本 ⇒ `undefined`**（调用方不得据此打分） */
  signal(agentId: string, taskKind: string): AgentOutcomeSignal | undefined {
    const list = this.buckets.get(bucketKey(agentId, taskKind));
    if (!list || list.length === 0) return undefined;
    const successes = list.filter((s) => s.success).length;
    return {
      sampleCount: list.length,
      successRate: Math.round((successes / list.length) * 100) / 100,
    };
  }

  /** 当前分桶数（供测试与观测） */
  size(): number {
    return this.buckets.size;
  }

  clear(): void {
    this.buckets.clear();
  }

  /** LRU：超出上限时淘汰**最早建立**的桶（Map 首项） */
  private evictIfNeeded(): void {
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) return;
      this.buckets.delete(oldest);
    }
  }
}

let globalLedger: AgentOutcomeLedger | null = null;

/** 全局唯一实例（结算点与未来的选人消费方共用） */
export function getAgentOutcomeLedger(): AgentOutcomeLedger {
  if (!globalLedger) globalLedger = new AgentOutcomeLedger();
  return globalLedger;
}

/** 测试用：重置全局实例（对齐既有 `reset*ForTest` 约定） */
export function resetAgentOutcomeLedgerForTest(): void {
  globalLedger = null;
}
