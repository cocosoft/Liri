// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatRecovery —— 启动期恢复装配 / yield 恢复器 / 会话内部续跑（ChatManager 拆分批 A4b）
 *
 * **来源**：提取自 `ChatManager.ts` 的 C18 恢复/yield 簇（D-01/D-03 文件规模债拆分）；
 * 方案见 `.trae/specs/file-size-debt-partition-plan.md` §9.3 / §13（A4b）。
 *
 * **职责（单一：恢复装配与内部续跑）**：
 *   ① `bootstrapYieldRecovery`：启动期 yield 恢复装配（先重建等待集 → 再装配恢复器）
 *   ② `bootstrapRecovery`：恢复编排入口（`sessionCrash → [sessionState] → yieldRecovery → lineage`）
 *   ③ `ensureYieldResumerInstalled`：装配 yield 恢复器（幂等；内含结算回放）
 *   ④ `resumeSessionInternally`：系统续跑一次会话（内部消费 `streamMessage`，不依赖 HTTP/SSE）
 *   ⑤ `rebuildTrailingTurnFromEvents`：无自动检查点时从 events.jsonl 尾部重建未完成 turn
 *
 * **⚠️ 与 A4b 计划的偏差（2026-10-05）**：`_rebuildTrailingTurnFromEvents` 在宿主
 * `resumeStream()` 中确有调用者（以实际内容为准，非"无宿主调用者"）⇒ 宿主不保留薄转发，
 * 改为宿主的 `resumeStream()` 直接调用本模块的 `rebuildTrailingTurnFromEvents`。
 * `_resumeSessionInternally` 无宿主调用者 ⇒ 整体迁出（宿主不保留）。
 *
 * **日志 module 名保持不变**：仍为 `chat:manager`（行为等价）。
 *
 * **注入依赖**（`ChatRecoveryDeps`，全 getter/闭包 ⇒ 无字段初始化顺序陷阱）：
 * 会话网关 / 会话生命周期 / 消息服务 / 事件日志 / token 追踪器 / 最新 turn / 流式入口，
 * 以及两个恢复器字段（`_yieldResumerInstalled` / `_yieldResumerUninstall`，被宿主 `cleanup()`
 * 直接读写）仍归宿主所有 —— 本模块不持有，经 getter/setter 注入。
 */

import { getLogger } from '@modules/monitoring';
import {
  getYieldRegistry,
  getYieldWaitingStore,
  rebuildYieldWaitingSet,
  setActiveSubagentRunProbe,
} from '../../session/yield';
// B1-4 验收缝：仅用于类型标注（启动钩子的可注入实例）
import type { YieldRegistry, YieldWaitingStore } from '../../session/yield';
// O9/G14：把本实例的 token 追踪器注册到模块级访问器（供摘要预算等跨模块读取"父当前上下文"）
import { setUnifiedTokenTracker } from '@modules/tokenBudget/UnifiedTokenTracker';
// 阶段 A（A1-e）：yield 恢复通路（子代理结算 → 恢复父会话）
import {
  setYieldResumeHandler,
  installYieldResumer,
  replayPendingSettlements,
  // O8⑤（v7.1）：重放投递的续跑正文（模型可见标记）
  buildYieldResumePrompt,
} from '../yield';
// B1-4 验收缝：仅用于类型标注（启动钩子的可注入实例）
import type { SettlementOutbox } from '../yield/SettlementOutbox';
// 阶段 A（N-26 修复）：SelfWake 唤醒执行器（fire 时真正唤醒会话）
import { setSelfWakeResumeHandler } from '@modules/tasks';
// M-7 idle 触发续接（2026-09-22）：目标停滞时的自动续跑（识别 + 可续性校验 + 文案）
import {
  isIdleContinuationTask,
  resolveIdleContinuation,
} from '@modules/tasks';
import { takeIdleContinuationInstruction } from '@modules/tasks';
import { getSubAgentEngine } from '@modules/tools';
import {
  RecoveryOrchestrator,
  getLineageSize,
  rebuildSessionLineage,
  type EventLogStorage,
  type SessionGateway,
  type RecoveryReport,
  type YieldRecoveryStats,
} from '@modules/session';
import type {
  Message,
  StreamMessageOptions,
} from '@modules/session/types/message.js';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type { SessionMetadata } from '@modules/session/types/session.js';
import type { SessionCheckpoint } from '@modules/session/types/checkpoint.js';
import { DataSessionStatus } from '@modules/core';
import { extractPendingToolCallsFromEvents } from '../utils/pendingToolCalls.js';
import type { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint.js';
import type { SessionLifecycleManager } from '../services/SessionLifecycleManager.js';
import type { MessageService } from '../services/MessageService.js';
import type { UnifiedTokenTracker } from '../../tokenBudget/UnifiedTokenTracker.js';

const logger = getLogger('chat:manager');

/** 本模块所需的注入依赖（跨簇共享状态仍归宿主 `ChatManager` 所有，经 getter 访问） */
export interface ChatRecoveryDeps {
  /** 会话网关（`bootstrapRecovery` 取崩溃恢复 / 派生状态重建 / 列会话） */
  getSessionGateway: () => SessionGateway;
  /** 取该会话当前最新 turn 编号（恢复器 `latestTurn` 判据） */
  getStreamMaxTurn: (sessionId: string) => Promise<number>;
  /** 本实例的 token 追踪器（注册到模块级访问器） */
  getUnifiedTracker: () => UnifiedTokenTracker;
  /** yield 恢复器是否已装配（宿主 `cleanup()` 亦读写） */
  getYieldResumerInstalled: () => boolean;
  /** 置位 yield 恢复器已装配标记（宿主 `cleanup()` 亦读写） */
  setYieldResumerInstalled: (value: boolean) => void;
  /** 保存恢复器卸载函数（宿主 `cleanup()` 亦读写） */
  setYieldResumerUninstall: (fn: (() => void) | null) => void;
  /** 流式入口（系统续跑内部消费；测试会替换宿主的实例属性） */
  streamMessage: (
    content: string,
    options?: StreamMessageOptions
  ) => AsyncGenerator<string | ChatStreamChunk, Message, unknown>;
  /** 取（或创建）会话事件日志（`rebuildTrailingTurnFromEvents` 读尾部事件） */
  getOrCreateEventLog: (sessionId: string) => EventLogStorage;
  /** 会话生命周期门面（取或加载会话） */
  getSessionLifecycle: () => SessionLifecycleManager;
  /** 消息服务（重建 assistant 消息） */
  getMessageService: () => MessageService;
}

export class ChatRecovery {
  constructor(private readonly deps: ChatRecoveryDeps) {}

  /**
   * B1-3 / B1-4（P0-2 / P0-4）：**启动期恢复装配** —— 不依赖任何用户活动。
   *
   * 顺序**不可交换**：
   * ① 装配等待集持久化端口（`YieldRegistry.setPersistence`）；
   * ② **先重建等待集**（`rebuildYieldWaitingSet`，含 `turn`）—— 否则回放时
   *    `registry.get()` 必为 undefined ⇒ 逐行 `markFailed` ⇒ 8 次后 `dropped`；
   * ③ 再装配恢复器（`_ensureYieldResumerInstalled` 内部触发 `replayPendingSettlements`）
   *    —— 此时回放才可能真正命中等待者。
   *
   * 修复前：装配只在 `streamMessage` / `sendMessage` 入口 ⇒ **无人发消息时
   * `pending` 行永不回放**（O8 台账实为"只写不生效"）。本方法由 `main.ts` 的启动
   * 序列调用（`wrapInit('YieldRecovery', ...)`）。
   *
   * B1-4 验收缝（2026-09-22）：`options` 只用于**测试注入**（临时库 / 独立实例，
   * 见 `tests/chat/bootstrapYieldRecovery.test.ts`）—— 回放链路读的是**进程级单例**，
   * 共享进程的测试若走单例就会污染真实 `~/.pyapp/data/app.db`。
   * **不传 `options` ⇒ 逐步退回原有全局单例取值，行为与装配前完全一致**
   * （`main.ts` 的现网调用点无需改动）。
   *
   * @param options 可选注入：`registry` / `store` / `outbox`（缺省取全局单例）
   */
  async bootstrapYieldRecovery(options?: {
    registry?: YieldRegistry;
    store?: YieldWaitingStore;
    outbox?: SettlementOutbox;
  }): Promise<YieldRecoveryStats> {
    const registry = options?.registry ?? getYieldRegistry();
    const store = options?.store ?? getYieldWaitingStore();
    registry.setPersistence(store);
    let restored = 0;
    try {
      restored = await rebuildYieldWaitingSet(store, registry);
      if (restored > 0) {
        logger.info('yield 等待集已重建（启动期）', { restored });
      }
    } catch (err) {
      // 重建失败不阻断启动：仅退化为"等待集为空"（与修复前一致）
      logger.warn('yield 等待集重建失败（不阻断启动）', { error: String(err) });
    }
    this.ensureYieldResumerInstalled(options?.outbox);
    // P2-7（2026-09-25）：返回统计供恢复编排层汇总（原返回 `void`；既有调用方忽略返回值即可）
    return { restored, resumerInstalled: this.deps.getYieldResumerInstalled() };
  }

  /**
   * P2-7（2026-09-25）：**恢复编排入口** —— 启动期用**一个入口**替代分散装配。
   *
   * 顺序与失败语义由 `RecoveryOrchestrator` 负责
   * （`sessionCrash → [sessionState] → yieldRecovery → lineage`）；本方法只**组装端口**并输出报告。
   *
   * 修复前：yield 侧由 `main.ts` 单独装配、session 崩溃恢复内联在（**懒调用**的）
   * `gateway.initialize()` 内、lineage 不重建 ⇒ 时机不对称，且没有一处能回答
   * "本次启动重建了什么、失败了几项"。
   *
   * @param opts.rebuildState 是否执行会话派生状态全量重建（默认 `false`，避免拖慢启动）
   */
  async bootstrapRecovery(opts?: {
    rebuildState?: boolean;
  }): Promise<RecoveryReport> {
    const gateway = this.deps.getSessionGateway();
    const orchestrator = new RecoveryOrchestrator({
      sessionCrash: { recover: () => gateway.recoverAfterCrash() },
      sessionState: { rebuild: (o) => gateway.rebuildDerivedState(o) },
      yieldRecovery: { bootstrap: () => this.bootstrapYieldRecovery() },
      lineage: {
        describe: () => ({ size: getLineageSize() }),
        // P3-1（2026-09-26，裁定 A）：**启动期从盘重建血缘** —— 数据源 = 会话 `metadata.parentSessionId`
        //（由 fork 写入，已有持久化）。⚠️ 必须 `includeTemporary: true`：血缘判定与"是否显示在
        //  历史列表"无关，漏掉 temporary 会让这些会话重启后失去祖先链（静默的部分失效）。
        rebuild: async () => {
          const sessions = await gateway.listSessions({
            includeTemporary: true,
          });
          return rebuildSessionLineage(
            sessions.map((session) => ({
              id: session.id,
              parentSessionId: session.metadata?.parentSessionId ?? null,
            }))
          );
        },
      },
    });
    return orchestrator.bootstrap(opts);
  }

  /**
   * 阶段 A（A1-e）：装配 yield 恢复器（幂等）。
   *
   * 恢复 = 「子代理全部结算 → 内部消费一次 `streamMessage`，让父会话继续」：
   * - **内部消费**：不依赖 HTTP 请求/SSE 传输层——落盘与事件写入由 `streamMessage`
   *   内部完成（`_finalizeStreamMessage` 等），前端下次打开会话即可见完整续跑结果；
   * - 注入内容带 `metadata.systemResume = true`，供上层区分"系统续跑"与用户消息；
   * - `hasActiveRuns`（B1/O1-2）取**子代理引擎 run 台账的会话级**判据：原实现恒 `false`，
   *   使得"同轮并发两批次"时第一批收口即恢复（第二批仍在跑）；改为 `true` 恒真又会把
   *   其他会话的在途 run 算成本会话的 ⇒ 只有按会话取值才既不早恢复也不永久等待。
   *
   * B1-4 验收缝（2026-09-22）：`outbox` 仅用于**参数透传**（测试注入临时台账，
   * 避免回放落到真实 `~/.pyapp/data/app.db`）。不传 ⇒ `replayPendingSettlements`
   * 走其自身默认值（全局单例），行为不变；置位逻辑（`_yieldResumerInstalled`）不变。
   */
  ensureYieldResumerInstalled(outbox?: SettlementOutbox): void {
    if (this.deps.getYieldResumerInstalled()) return;
    this.deps.setYieldResumerInstalled(true);

    setYieldResumeHandler(({ sessionId, reason }) =>
      this.resumeSessionInternally(
        sessionId,
        // O8⑤（v7.1）：重放投递的续跑正文带**模型可见**标记（原来只进 metadata ⇒ 模型不可见）
        buildYieldResumePrompt(reason),
        { systemResume: true, yieldReason: reason }
      )
    );

    // 阶段 A（N-26 修复）：SelfWake 原为"空唤醒"（只 markFired、会话不继续），
    // 现复用同一续跑实现 —— `sleep_for` / `wake_on` 到点后会话真正被唤醒。
    setSelfWakeResumeHandler(async ({ sessionId, kind, taskId, reason }) => {
      // M-7 idle 触发续接（2026-09-22）：目标停滞（`blocked`）时的自动续跑。
      // 与"睡醒续跑"**共用同一执行器**，但提示词取 `goalTemplates.continue_goal`
      //（M-7 单一来源），并多两道闸门：
      // ① 目标**仍可续**（`resolveIdleContinuation`：仍 `blocked` 且 streak 未变）——
      //    已完成 / 触顶 / 判停 / 期间又有新结算 ⇒ 该唤醒作废（no-op）；
      // ② 会话**此刻确实空闲**（无在途子代理 run）—— 与 yield 登记守卫同源判据。
      // 注：账户级串行由 `ChatOrchestrator` 的会话 mutex 保证（同会话 turn 不会交错）。
      if (isIdleContinuationTask(taskId)) {
        const target = await resolveIdleContinuation({ taskId });
        if (!target) {
          logger.info('目标空闲续接跳过：目标已不可续（终态 / 陈旧唤醒）', {
            sessionId,
            taskId,
          });
          return { ok: false, error: 'goal_not_continuable' };
        }
        if (hasActiveRuns(sessionId)) {
          logger.info('目标空闲续接跳过：会话仍忙（有在途子代理 run）', {
            sessionId,
            goalId: target.goalId,
          });
          return { ok: false, error: 'session_busy' };
        }
        logger.info('目标空闲续接执行', {
          sessionId,
          goalId: target.goalId,
          streak: target.streak,
        });
        // B2-2 / X2（2026-09-23）：续接指令是**模型可见输入**（下方作为 user 消息注入）
        // ⇒ 渲染与落 `goal/injected{channel:'user_message'}` **成对**且**先落盘**，
        // 返回的正文即注入正文（§1.6 红线：模型看到了什么必须可重建）。
        // B2-2 / X4（2026-09-23）：`updated_reason === 'manual'`（目标被 PATCH 显式改过）
        // ⇒ 续接改用 `objective_updated`（重新对齐新目标），而非 `continue_goal`。
        // 判定只看**枚举原因码**，不看 objective 文案（CS02）。
        const continuationText = await takeIdleContinuationInstruction({
          sessionId,
          goalId: target.goalId,
          objective: target.objective,
          streak: target.streak,
          realignToObjective: target.updatedReason === 'manual',
        });
        return this.resumeSessionInternally(sessionId, continuationText, {
          systemResume: true,
          goalId: target.goalId,
          idleContinuation: true,
        });
      }
      return this.resumeSessionInternally(
        sessionId,
        '你此前挂起的等待条件已满足，请继续未完成的任务（系统自动唤醒，无需用户确认）。',
        { systemResume: true, selfWakeKind: kind, selfWakeReason: reason }
      );
    });

    const hasActiveRuns = (sessionId: string): boolean =>
      getSubAgentEngine().hasActiveAgentForSession(sessionId);

    // B1/O1-3（A10 修断链）：同一判据供 yield 登记守卫使用——无在途 run 时拒绝登记，
    // 否则"模型无子代理却调 sessions_yield"会登记永久等待（结算通知永不触发）。
    setActiveSubagentRunProbe(hasActiveRuns);
    // O9/G14：注册 token 追踪器（本装配点每次 streamMessage/sendMessage 都会走到，幂等）
    setUnifiedTokenTracker(this.deps.getUnifiedTracker());

    this.deps.setYieldResumerUninstall(
      installYieldResumer({
        hasActiveRuns,
        latestTurn: (sid) => this.deps.getStreamMaxTurn(sid),
      })
    );

    // O8（B5）：装配后**回放**未确认送达的结算信号（崩溃点落在"已结算 → 已恢复"之间）
    // 带 `restored: true` 重投；失败不影响装配本身
    void replayPendingSettlements(
      {
        hasActiveRuns,
        latestTurn: (sid) => this.deps.getStreamMaxTurn(sid),
      },
      outbox
    ).catch((err) => {
      logger.warn('结算信号回放失败', { error: String(err) });
    });
  }

  /**
   * 阶段 A：系统续跑一次会话（内部消费 `streamMessage`，不依赖 HTTP/SSE；
   * 落盘与事件写入由 `streamMessage` 内部完成）。
   *
   * 供两条通路共用：yield 恢复（`YieldResumer`）与 SelfWake 唤醒（`SelfWakeService.fire`）。
   */
  private async resumeSessionInternally(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string }> {
    let result: { ok: boolean; error?: string };
    try {
      const generator = this.deps.streamMessage(content, {
        sessionId,
        metadata,
      });
      for await (const chunk of generator) {
        void chunk; // 丢弃：落盘与事件写入由 streamMessage 内部完成
      }
      result = { ok: true };
    } catch (err) {
      result = { ok: false, error: String(err) };
    }

    // 阶段 A（遗留项 2 · 前端实时可见性）：系统续跑内部消费 `streamMessage`，
    // 不走 HTTP/SSE 传输层 —— 前端无从得知会话已在后台续跑。此处按
    // `project:auto_created` 同款模式广播，前端命中当前打开会话时重拉消息，
    // 用户无需操作即可见续跑结果；失败时同样广播（中途异常也可能已落盘部分内容）。
    try {
      const { broadcastEvent } = await import('@modules/infrastructure');
      broadcastEvent('session:continued', { id: sessionId, ok: result.ok });
      logger.info('系统续跑：SSE 广播完成', { sessionId, ok: result.ok });
    } catch (e) {
      // 广播失败不影响主流程，也不得违反本方法「不抛异常」的调用契约
      logger.warn('系统续跑 SSE 广播失败', {
        sessionId,
        error: (e as Error)?.message ?? String(e),
      });
    }
    return result;
  }

  /**
   * M2-T2.1（2026-08-31）：无自动检查点时从 events.jsonl 尾部重建未完成 turn。
   *
   * 对齐 openworker `_unanswered_trailing_tool_calls` 语义：
   *   1. answered = 已有 tool/result 或 tool/canceled 终态的工具（已答项不重复执行）
   *   2. 从事件尾部向前扫 assistant/tool_call，遇 user/message 停止（新对话边界）
   *   3. 返回 gateway 消息（LLM 上下文）+ answered 集合；尾部无未完成工具 → null
   *
   * 场景：审批时引擎已停止/进程已重启（无自动检查点落盘），
   * 审批答复到达后从持久化事件日志恢复续跑。
   */
  async rebuildTrailingTurnFromEvents(
    sessionId: string
  ): Promise<Awaited<ReturnType<StreamingAutoCheckpoint['restore']>>> {
    const log = this.deps.getOrCreateEventLog(sessionId);
    const tailSeq = await log.getTailSeq();
    if (tailSeq <= 0) return null;
    const events = await log.read({
      fromSeq: Math.max(1, tailSeq - 3000 + 1),
      limit: 3000,
    });
    if (events.length === 0) return null;

    // answered：已有终态（result/canceled）的工具——已答项不重复执行
    const { pending, answered } = extractPendingToolCallsFromEvents(events);
    if (pending.length === 0) {
      logger.info('M2: events 尾部无未完成工具，跳过重建', { sessionId });
      return null;
    }

    // 上下文消息：gateway 已落盘消息（写前持久化保证 tool_call 消息已入投影）
    const session = await this.deps
      .getSessionLifecycle()
      .getOrLoadSession(sessionId);

    // 极端崩溃（tool_call 消息未落盘）：尾部无匹配未答工具 → 注入重建消息，
    // 使 resumeStream 的 remainingToolCalls 提取（按 metadata.tool_calls 扫描）能命中
    const hasPendingToolCalls = session.messages.some((m) => {
      if (m.role !== 'assistant' || !m.metadata?.tool_calls) return false;
      const tcs = m.metadata.tool_calls as Array<{ id?: string }>;
      return tcs.some(
        (tc) => tc.id && pending.some((p) => p.toolCallId === tc.id)
      );
    });
    if (!hasPendingToolCalls) {
      const firstPending = pending[0];
      const rebuilt = this.deps.getMessageService().createAssistantMessage('', {
        sessionId,
      }) as unknown as Message;
      rebuilt.id =
        firstPending.messageId ?? `msg-${sessionId}-rebuild-${Date.now()}`;
      rebuilt.createdAt = new Date();
      rebuilt.updatedAt = new Date();
      rebuilt.metadata = {
        tool_calls: pending.map((p) => ({
          id: p.toolCallId,
          type: 'function',
          function: { name: p.name, arguments: JSON.stringify(p.args ?? {}) },
        })),
      };
      session.messages = [...session.messages, rebuilt];
    }

    logger.info('M2: 无检查点，从 events 尾部重建未完成 turn', {
      sessionId,
      eventCount: events.length,
      answeredCount: answered.size,
      pendingCount: pending.length,
      rebuilt: !hasPendingToolCalls,
    });

    return {
      checkpoint: {
        ...({} as SessionCheckpoint),
        id: 'events-rebuild',
        sessionId,
        createdAt: Date.now(),
        messages: session.messages,
        metadata: {} as SessionMetadata,
        state: DataSessionStatus.ACTIVE,
      },
      stepIndex: 0,
      completedToolCallIds: Array.from(answered),
      generatorState: { toolTurnCount: 0, llmCallCount: 0 },
    };
  }
}
