// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * usageAccounting — LLM 响应用量的记账外移（issue #8 · Cut C，2026-10-29）
 *
 * 迁出来源：`ChatManager.recordChatResponseUsage` 的方法体（原 2283–2354，约 72 行）。
 * 内容只做**记账与观测事件落盘**（水位预算 / 日预算结算 / 目标入账 / `metric/timing`），
 * 不含任何"是否拦截"的判定（USD 闸门另在 S3，未接入）。
 *
 * 行为不变红线（issue #8）：不新增配置项、不改默认值、不改事件名；
 * 本函数保持**同步签名**（事件落盘 fire-and-forget，失败只记日志）。
 */

import { getLogger } from '@openliri/infra/monitoring';
// 落盘去抖窗口（D-2 裸字面量规则：`*_MS = <数字>` 只能落在 constants/）
import { SESSION_USAGE_PERSIST_DEBOUNCE_MS } from '@openliri/infra/constants';
import type { LiriEvent } from '@modules/session/types/events';
import { chargeSessionGoalUsage } from '@modules/tasks';
import { buildRequestTimingData } from '../services/timingEvent';
// R16：每日预算（进程共享单例；S3 后**主口径=金额**，Token 轨只观测）
import {
  getDailyBudget,
  recordTurnCostUsd,
} from '@modules/query/DailyBudgetManager';

const logger = getLogger('chat:manager');

export interface UsageAccountingPorts {
  /** 会话/循环水位预算（`TokenBudgetController.consumeTokens`） */
  tokenBudget: { consumeTokens(tokens: number): void };
  /** 统一 token 追踪（校准闭环：`recordTimingUsage`） */
  unifiedTracker: {
    recordTimingUsage(
      timing: NonNullable<ReturnType<typeof buildRequestTimingData>>
    ): void;
  };
  /** 会话事件日志写入（`metric/timing` 落盘；实现自带 try/catch） */
  appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
  /**
   * 2026-11-11：会话内存表 + 落盘回调 —— 用于回写 `metadata.totalTokens/totalCost`。
   *
   * 真机缺陷：此前只记预算/金额台账，从不回写会话元数据 ⇒ 列表与详情里
   * 所有会话恒为 `totalTokens: 0 / totalCost: 0`。
   * （两个字段以最小结构声明，避免 `chat` 层与本模块互相依赖具体会话类型。）
   */
  chatSessions?: ReadonlyMap<string, { metadata?: object }>;
  persistSession?: (session: { metadata?: object }) => void | Promise<void>;
}

/** 同一会话的待落盘计时器（以会话对象为键，避免在宿主类里再加一张 Map） */
const USAGE_PERSIST_TIMERS = new WeakMap<
  object,
  ReturnType<typeof setTimeout>
>();

/** 把用量累加到会话元数据并去抖落盘（会话未加载 ⇒ 跳过） */
function accumulateSessionTotals(
  ports: UsageAccountingPorts,
  sessionId: string,
  tokens: number,
  costUsd: number
): void {
  const session = ports.chatSessions?.get(sessionId);
  if (!session?.metadata) return;
  const metadata = session.metadata as Record<string, unknown>;
  const totals = addSessionUsageTotals(metadata, tokens, costUsd);
  metadata.totalTokens = totals.totalTokens;
  metadata.totalCost = totals.totalCost;

  const pending = USAGE_PERSIST_TIMERS.get(session);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    USAGE_PERSIST_TIMERS.delete(session);
    Promise.resolve(ports.persistSession?.(session)).catch((err) => {
      // @ignore-catch — 用量累计属观测面，落盘失败不得影响主流程（CS03）
      logger.warn('会话用量落盘失败（不影响主流程）', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, SESSION_USAGE_PERSIST_DEBOUNCE_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
  USAGE_PERSIST_TIMERS.set(session, timer);
}

/**
 * 2026-11-11：会话级用量累计（纯函数，便于单测）。
 *
 * - token 取整累加；金额保留 6 位小数（避免浮点噪声累积成 `0.30000000000000004`）；
 * - 存量字段缺失 / 非有限数字 ⇒ 按 0 起算（历史会话元数据可能没有这两个字段）。
 */
export function addSessionUsageTotals(
  metadata: Record<string, unknown>,
  tokens: number,
  costUsd: number
): { totalTokens: number; totalCost: number } {
  const prevTokens = Number(metadata.totalTokens ?? 0);
  const prevCost = Number(metadata.totalCost ?? 0);
  const totalTokens =
    (Number.isFinite(prevTokens) ? prevTokens : 0) +
    (Number.isFinite(tokens) ? Math.round(tokens) : 0);
  const totalCost =
    Math.round(
      ((Number.isFinite(prevCost) ? prevCost : 0) +
        (Number.isFinite(costUsd) ? costUsd : 0)) *
        1e6
    ) / 1e6;
  return { totalTokens, totalCost };
}

/**
 * 记录 LLM 响应的令牌用量
 *
 * @param requestId P2-2（2026-09-23）：所属请求标识（= 同请求 `request/start` 的 seq）。
 *   **仅透传新增字段**，不改任何用量口径（TR-11 修复的 usage 语义/守卫原样）；
 *   拿不到（工具轮 / 非流式路径 / start 落盘失败）⇒ 不写该字段。
 * @param model 债四「换算接线」（2026-10-13）：本轮**实际模型**（供金额台账取价换算）。
 *   缺失 / 占位 `'unknown'` ⇒ 只记 token、**不记金额**（**不臆造金额**，见 `recordTurnCostUsd`）。
 */
export function recordChatResponseUsage(
  ports: UsageAccountingPorts,
  sessionId: string,
  usage: Record<string, number> | null | undefined,
  requestId?: number,
  model?: string
): void {
  if (!usage) return;
  const inputTokens = usage.prompt_tokens ?? usage.inputTokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return;

  const totalTokens = inputTokens + outputTokens;
  ports.tokenBudget.consumeTokens(totalTokens);

  // R16（台账 L-14）：**每日 Token 预算**（进程共享单例）——**结算**本会话预扣
  // （`reserveFor` 在发送前预留；此处多退少补为真实用量），覆盖主/快速/流式；
  // 与 `tokenBudget`（按会话/循环的水位预算）用途不同、各自记账。
  getDailyBudget().settleFor(sessionId, totalTokens);

  // X8（2026-09-23，Spec §5.5）：**主会话**用量入账到该会话的未终结目标。
  // **记账与判定解耦**：此处只 fire-and-forget 写库（不 await ⇒ 不改本方法同步签名、
  // 不阻塞响应）；"触顶 ⇒ 下一轮请求前 steering 收尾"的判定在既有闸门
  // （`ReActToolLoop.beforeReasoning` 的 `checkBeforeRequest` 处）读库进行 ——
  // 不在记账处主动发起/唤醒任何请求。
  // 与 swarm 批次路径（`settleGoalForRun` 记 worker 汇总用量）**不同源、不重复计数**。
  // 无目标会话 ⇒ `chargeSessionGoalUsage` 立即返回 null（不建行、不写库）。
  void chargeSessionGoalUsage({
    sessionId,
    tokens: totalTokens,
  }).catch((err) => {
    // @ignore-catch — 目标用量入账属观测/意图面，失败不得影响用量记账与主流程（CS03）
    logger.warn('目标用量入账失败（不影响用量记账与主流程）', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // TR-12-A（2026-09-22）：请求级用量分桶落事件（含缓存命中/写入，供轨迹"用量"视图）。
  // 本方法是**同步**签名（由管线 ctx 注入调用），故不 await；`appendStreamEvent` 自带
  // try/catch 并返回 `{ok,reason}`，失败只记日志 —— 该事件是**可观测数据**，不是渲染依赖，
  // 不能因其失败影响用量记账与主流程。
  let costUsd = 0;
  const timingData = buildRequestTimingData(usage);
  if (timingData) {
    // 债四「换算接线」（2026-10-13）：**金额**台账（`usedUsd`）与 token 口径**并行**。
    // 四参**复用 `timingData`**（缓存字段的唯一提取点 `extractCacheTokens`，CS01 不另造一份）；
    // 模型不可得 ⇒ 内部跳过并如实 warn（**不臆造金额**）。
    // ⚠️ **不改闸门**：`usedUsd` 当前不参与任何拦截/档位判定（USD 闸门 = S3，待 U3 裁定）。
    costUsd = recordTurnCostUsd(
      {
        inputTokens: timingData.inputTokens ?? 0,
        outputTokens: timingData.outputTokens ?? 0,
        cacheCreationTokens: timingData.cacheCreationTokens,
        cacheReadTokens: timingData.cacheReadTokens,
      },
      model,
      sessionId
    );
    // D1（2026-09-23）：**同一份载荷**先喂入校准闭环 —— 校准的数据源即
    // `metric/timing` 事件的用量字段（唯一构造点 `buildRequestTimingData`），
    // 不再依赖 `traces/` 落盘数据（已降级为观测层）。复用既有"调用方直接喂入"通路。
    ports.unifiedTracker.recordTimingUsage(timingData);
    // P2-2：请求边界配对键（与延迟条共享同一 requestId ⇒ 读端归并为一个请求区间）
    if (requestId !== undefined) timingData.requestId = requestId;
    void ports.appendStreamEvent(sessionId, {
      type: 'metric/timing',
      seq: 0, // 由 append 在 mutex 内原子分配（P3-7a）
      time: Date.now(),
      sessionId,
      data: timingData,
    });
  }

  // 2026-11-11：回写会话级累计（内存即时生效 + 去抖落盘）
  accumulateSessionTotals(ports, sessionId, totalTokens, costUsd);
}
