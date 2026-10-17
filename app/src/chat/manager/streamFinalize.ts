// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatStreamFinalize —— 流式消息收尾簇（ChatManager 拆分批 U-22/S4）
 *
 * **来源**：从 `ChatManager.ts` 外移 `_finalizeStreamMessage`（294 行，P2-3.5 提取自
 * `streamMessage` 的 finally 与最终 return）。
 *
 * **职责（单一：一轮流式请求**如何收尾**）**：
 *   ① 兜底落盘 assistant 消息（非工具调用路径）
 *   ② 工具型轮次补写 `turn/end`（顺序契约：`turn/start → … → assistant/tool_call → turn/end`）
 *   ③ 资源清理（流式水位 / 会话状态机 / OTel span / abort 控制器 / executionId）
 *   ④ 收尾副作用（跨轮摘要、Session Memory、telemetry、会话摘要、隐性引擎钩子）
 *   ⑤ 等待未完成持久化 → 递增 turn 计数 → 返回最终消息
 *
 * **行为等价**：日志文案、事件载荷、条件分支与 `.catch` 兜底语义**逐字未变**
 * （仅把 `this.` 换成注入的 deps）。日志 module 名仍为 `chat:manager`。
 *
 * **注入依赖**（`StreamFinalizeDeps`，全闭包 ⇒ 无字段初始化顺序陷阱）。
 */

import { SpanStatusCode } from '@opentelemetry/api';

import { agentTelemetry } from '@modules/agent';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import type { LiriEvent } from '@modules/session/types/events';
import type {
  Message,
  StreamMessageOptions,
  ChatResponse,
} from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';

import { getYieldRegistry } from '../../session/yield';
import { ImplicitEngineHook } from '../../project/ImplicitEngineHook';
import { isExecutionTaskIntent, isStrongBuildIntent } from '../taskIntent';

const logger = getLogger('chat:manager');

export interface StreamFinalizeDeps {
  /** 消息落盘（宿主 `_addAndPersistMessage`） */
  addAndPersistMessage: (sessionId: string, message: Message) => Promise<void>;
  /** 当前轮编号（事件日志已写入的最大 turn） */
  getStreamMaxTurn: (sessionId: string) => Promise<number>;
  /** per-session 工具轮计数 */
  getToolRound: (sessionId: string) => number;
  /** 该 turn 是否已写过 `turn/end`（单写者幂等守卫） */
  hasTurnEnded: (sessionId: string, turn: number) => boolean;
  /** 事件日志尾部 seq */
  getStreamTailSeq: (sessionId: string) => Promise<number>;
  /** 事件写入唯一入口 */
  appendStreamEvent: (sessionId: string, event: LiriEvent) => Promise<unknown>;
  /** 停止流式水位监测（仅本会话） */
  endStreamSession: (sessionId: string) => void;
  /** 会话状态机收口（idle） */
  finishSessionMachine: (sessionId: string, reason: string) => void;
  /** 会话级中止控制器（与宿主共享同一 Map） */
  sessionAbortControllers: Map<string, AbortController>;
  /** 会话级 executionId（与宿主共享同一 Map） */
  sessionExecutionIds: Map<string, string>;
  /** 跨轮对话摘要持久化 */
  persistTurnSummary: (session: ChatSession) => void;
  /** Session Memory 累计 */
  accumulateSessionMemory: (
    sessionId: string,
    content: string,
    accumulatedContent: string,
    tokens: number,
    toolCalls: number
  ) => void;
  /** 最近 N 条 user 文本 */
  recentUserText: (session: ChatSession, n?: number) => string;
  /** Code Mode 判定 */
  shouldUseCodeMode: (message: string) => boolean;
  /** 裸会话 ⇒ PDCA 升级 */
  escalateToPdcaViaBareSession: (params: {
    session: ChatSession;
    assistantContent: string;
    lastUserContent: string;
  }) => Promise<void>;
  /** 自动建项目（goal + 产出物达标且会话未关联项目） */
  autoCreateProject: (
    session: ChatSession,
    workspaceId: string | undefined,
    result: { hasGoal: boolean; deliverables: number; goalSummary?: string }
  ) => Promise<string | null>;
  /** PDCA launch 统一出口 */
  maybeLaunchPdca: (
    session: ChatSession,
    assistantContent: string,
    projectId: string,
    lastUserContent: string | undefined
  ) => void;
  /** Tracker 灰度开关 */
  isTelemetryEnabled: () => boolean;
  /** 会话摘要生成（异步，不阻塞消息流） */
  summarizeSession: (session: ChatSession, message: Message) => void;
  /** 等待所有未完成的持久化（WAP 规范） */
  flushPendingPersists: () => Promise<void>;
  /** per-session turn 计数递增 */
  incToolRound: (sessionId: string) => void;
}

export class ChatStreamFinalize {
  constructor(private readonly deps: StreamFinalizeDeps) {}

  /**
   * P2-3.5: 流式消息最终化 — 清理资源 + 持久化 + 构建返回消息
   *
   * 提取自 streamMessage 的 finally 块和最终 return 逻辑。
   */
  async finalize(
    session: ChatSession,
    content: string,
    accumulatedContent: string,
    assistantMessage: Message,
    finalResponse: ChatResponse | null,
    streamAbortController: AbortController,
    streamSpan: ReturnType<ReturnType<typeof getOTelTracing>['startSpan']>,
    options?: StreamMessageOptions,
    /** TB-16（2026-09-24）：主循环终止判定（写入 `turn/end.terminationReason`） */
    terminationReason?: string
  ): Promise<Message> {
    const deps = this.deps;

    // P0-fix: 确保助手消息已持久化（非工具调用路径在此处落盘，工具调用路径已由 _buildToolRoundMessages 处理）
    const lastMsg = session.messages[session.messages.length - 1];
    if (!lastMsg || lastMsg.id !== assistantMessage.id) {
      await deps.addAndPersistMessage(session.id, assistantMessage);
    }

    // P0-fix-3（2026-08-23，顺序错乱根因）：工具调用轮次的 turn/end 在此补写。
    // 时机关键：assistant/tool_call 事件由 _addAndPersistMessage 落盘时（convertMessage）生成，
    // 必须在本方法内、落盘 assistant 消息**之后**写入 turn/end，才能保证：
    //   events.jsonl 顺序 = turn/start → text/thinking → tool/result → assistant/tool_call → turn/end
    // （此前在 streamMessageFlow 工具循环后补写，tool_call 事件晚于 turn/end，仍无 turn 包裹。）
    // 无工具调用轮次：turn/end 已在 streamMessageFlow LLM 流结束后写入（!hasToolCalls 分支），此处不重复写。
    // 2026-08-24 修复：写入条件从"最终响应有 tool_calls"放宽为"本轮发生过工具活动"——
    // 工具型轮次若最终响应无 tool_calls（工具执行后直接给答案），原逻辑不写 turn/end，
    // turn 永久未闭合 → 崩溃恢复每次启动合成 canceled closers → 前端所有回复显示"该回复已中断"。
    const hasFinalToolCalls =
      Array.isArray(finalResponse?.tool_calls) &&
      finalResponse!.tool_calls.length > 0;
    const hasToolActivity =
      hasFinalToolCalls ||
      (Array.isArray(assistantMessage.blocks) &&
        assistantMessage.blocks.some(
          (b) => b.type === 'tool_call' || b.type === 'tool_result'
        ));
    if (hasToolActivity) {
      try {
        // turn 编号与 turn/start 一致：turn/start 已写入事件日志，读取最大 turn 即为当前轮编号
        const persistedTurn = await deps.getStreamMaxTurn(session.id);
        const turn =
          persistedTurn > 0 ? persistedTurn : deps.getToolRound(session.id) + 1;
        // Fix2（2026-09-05）：turn/end 单写者幂等——若该 turn 已被 streamMessageFlow
        // 或本 finalize 写过 end（appendStreamEvent 中央登记），跳过，杜绝双 end。
        // 阶段 A（A1-d）：本轮若以 sessions_yield 让出（act 阶段已登记等待），
        // turn/end 携带 yield 语义；并回填 turn 编号供恢复侧的"取代判定"使用。
        // 注意：**不写 PAUSED**——会话对外状态保持 running（阶段A-恢复通路设计Spec §3-D2）。
        const yieldRegistry = getYieldRegistry();
        const yieldPending = yieldRegistry.get(session.id);
        if (yieldPending) {
          yieldRegistry.updateTurn(session.id, turn, yieldPending);
        }
        if (!deps.hasTurnEnded(session.id, turn)) {
          const ts = await deps.getStreamTailSeq(session.id);
          await deps.appendStreamEvent(session.id, {
            type: 'turn/end',
            seq: ts + 1,
            time: Date.now(),
            sessionId: session.id,
            data: {
              turn,
              finishReason: yieldPending
                ? 'yielded'
                : hasFinalToolCalls
                  ? 'tool_use'
                  : 'stop',
              // TB-16（2026-09-24）：主循环终止判定（与 finishReason 语义不同；无循环时省略）
              ...(terminationReason ? { terminationReason } : {}),
              ...(yieldPending ? { yielded: true } : {}),
            },
          });
        }
      } catch {
        // @ignore-catch — 事件追加失败不阻断主流程
      }
    }

    // Phase 1c: 停止流式水位监测（仅停本会话，不再误停其他并发会话）
    deps.endStreamSession(session.id);
    // 通知会话状态变化为空闲状态
    deps.finishSessionMachine(session.id, '工具执行完成');
    getOTelTracing().endSpan(streamSpan, SpanStatusCode.OK);

    // Bug Fix: 清理 AbortController（当前流已完成，允许新请求）
    if (
      deps.sessionAbortControllers.get(session.id) === streamAbortController
    ) {
      deps.sessionAbortControllers.delete(session.id);
    }
    // B-05（2026-10-09）：同步清理会话 `executionId`（仅当仍属本次流）
    if (deps.sessionExecutionIds.get(session.id) === options?.executionId) {
      deps.sessionExecutionIds.delete(session.id);
    }

    // 跨轮对话摘要：保存关键决策
    deps.persistTurnSummary(session);

    // Session Memory: 累计本轮数据，达到阈值则触发提炼
    deps.accumulateSessionMemory(
      session.id,
      content,
      accumulatedContent,
      finalResponse?.usage?.inputTokens || 0,
      finalResponse?.tool_calls?.length || 0
    );

    options?.onComplete?.(assistantMessage);

    // 隐性引擎钩子：项目会话的消息完成后，触发 Plan/Do/Check/Act 分析
    // P0-4: 优先使用 projectId（项目上下文），兜底 workspaceId（UI 环境）
    const contextId =
      (session.metadata?.projectId as string | undefined) ??
      (session.metadata?.workspaceId as string | undefined);

    // P0-1（2026-09-06，A1/C2）：裸会话（无 projectId/workspaceId）不经过 persist 门
    // （persist 被 contextId 门控），此处独立轻量预筛——执行意图（X 预筛）+ 非 code mode
    // → 强意图直接自动：自动建项目（default workspace）→ 同轮 _maybeLaunchPdca（决策 1-A）。
    // A4 轮次闸（R4 放宽，2026-09-06 走查 W5）：第 2+ 轮一律可升级；首轮仅当首条消息命中
    // 【强产出意图】（帮我/我要…做/写/开发）放行——"首条即复杂任务"的小白场景不再被
    // 拦（走查实证：首条"帮我做个游戏"因轮次闸被拦、长跑无方法论接管）；弱动词
    // （检查/验证/补）与纯闲聊首条仍要求 2+ 轮，防一次性求助/闲聊被误升级。
    // P0-1 修正（走查发现）：任务轮内模型可能 ask_user_question 澄清，澄清回答/后续
    // 消息会占住"最后一条 user"位置使任务原句被覆盖 → 判定聚合最近 3 条 user 文本。
    const bareUserMessages =
      session.messages?.filter((m) => m.role === 'user') ?? [];
    const bareLastContent = deps.recentUserText(session, 3);
    const bareFirstContent =
      bareUserMessages.length > 0
        ? (((bareUserMessages[0] as unknown as Record<string, unknown>)
            ?.content as string) ?? '')
        : '';
    if (
      !contextId &&
      assistantMessage.content &&
      (bareUserMessages.length >= 2 || isStrongBuildIntent(bareFirstContent)) &&
      isExecutionTaskIntent(bareLastContent) &&
      !deps.shouldUseCodeMode(bareLastContent)
    ) {
      logger.info('pdca:bare_session_intent_detected', {
        sessionId: session.id,
        intent: bareLastContent.slice(0, 60),
      });
      await deps.escalateToPdcaViaBareSession({
        session,
        assistantContent: assistantMessage.content as string,
        lastUserContent: bareLastContent,
      });
    }

    // S6/PDCA 门控修正（2026-09-06）：persist 分支不再要求 assistantMessage.content 非空——
    // 工具型收尾消息 content 常为 ''（chatStream fullContentLength=0），原门控令项目会话内的
    // 新目标消息被整段跳过：引擎无判定、PDCA 不 launch（走查实证 04:40:51，620s 任务完成零判定）。
    const userMessagesForGoal =
      session.messages?.filter((m) => m.role === 'user') ?? [];
    const lastUserContent =
      userMessagesForGoal.length > 0
        ? (((
            userMessagesForGoal[
              userMessagesForGoal.length - 1
            ] as unknown as Record<string, unknown>
          ).content as string) ?? '')
        : '';
    if (contextId && (assistantMessage.content || lastUserContent.trim())) {
      // S6 修正（2026-09-06）：把用户最后一条消息一并交给引擎做 goal 判定（persist userText）——
      // "帮我做xx"请求句在用户消息里、而 persist 主输入是助手回复；不纳入则引擎 hasGoal 恒漏判
      // （走查实证 03:30:06），下方 fallback 退化为常驻路径而非兜底。
      ImplicitEngineHook.persist(
        contextId,
        (assistantMessage.content as string) ?? '',
        undefined,
        session.id,
        lastUserContent
      )
        .then(async (result) => {
          // P0: 自动建项目 — 检测到 goal + deliverable 且会话未关联项目时自动创建
          // P3-1: 用户消息含明确项目意图时降阈值为 1，否则保持 2
          const hasExplicitIntent =
            /(?:帮我|我要|我想|给我)\s*(?:做|开发|规划|设计|建|创建|写|整理|实现|搭建|部署)/.test(
              lastUserContent
            );
          const deliverableThreshold = hasExplicitIntent ? 1 : 2;

          // PDL 启动修复（2026-09-05，K3 排查）：ImplicitEngineHook 的 hasGoal 仅靠文本
          // 正则（须含"目标：…"等字样），普通"实现计划/分步/补测试"措辞永不命中 → 自动
          // PDCA/PDL 在项目会话形同虚设。此处对【项目会话 + 用户明确产出意图】兜底放行
          // goal；复杂/危险任务仍由 _shouldUsePlanDrivenLoop 分流进 LRTO（只放行升级通道）。
          const userTaskIntent = isExecutionTaskIntent(lastUserContent);
          const goalTriggered =
            result.hasGoal ||
            (Boolean(session.metadata?.projectId) &&
              userTaskIntent &&
              !deps.shouldUseCodeMode(lastUserContent || ''));
          if (goalTriggered && !result.hasGoal && session.metadata?.projectId) {
            logger.info('pdca:goal_fallback_by_user_intent', {
              sessionId: session.id,
              projectId: session.metadata.projectId,
              intent: lastUserContent.slice(0, 60),
            });
          }

          // P0-1（2026-09-06，A1 同轮串联）：await 自动建项目完成（内部已写
          // session.metadata.projectId 并持久化），使下方 launch 判定在本轮即可读到
          // projectId —— 消除"首轮只建项目、绝不 launch PDCA"的时序互斥。
          // 失败返回 null 仅告警，不阻塞消息流（CS03）。
          if (
            result.hasGoal &&
            result.deliverables >= deliverableThreshold &&
            !session.metadata?.projectId
          ) {
            await deps.autoCreateProject(session, contextId, result);
          }

          // 升级通道：检测到目标时自动发起完整 PDCA 循环（统一出口 _maybeLaunchPdca，
          // P0-1 提取：含会话级 launch 锁防重复卡片、分流决策 trace、双路径 launch）
          // CM-6 互斥（2026-08-25）：Code Mode 分流命中时跳过 PDCA，避免双引擎并发
          if (goalTriggered && session.metadata?.projectId) {
            if (!deps.shouldUseCodeMode(lastUserContent || '')) {
              deps.maybeLaunchPdca(
                session,
                assistantMessage.content as string,
                session.metadata.projectId as string,
                lastUserContent
              );
            } else {
              // A4（2026-09-06，P1-1）：Code Mode 命中目标意图 → 显式提示而非静默跳过
              // （原 CM-6 静默互斥让用户以为"没触发"，现经 pdca:decision 事件告知前端）。
              logger.info('pdca:skip_code_mode', {
                sessionId: session.id,
                projectId: session.metadata.projectId,
              });
              import('../../tasks/PdcaLiveEvents')
                .then((m) =>
                  m.emitPdcaLiveEvent(
                    'pdca:decision',
                    {
                      sessionId: session.id,
                      projectId: session.metadata?.projectId,
                    },
                    {
                      decision: 'code-mode',
                      message:
                        '检测到目标任务，但当前处于 Code Mode（CM-6 互斥未启动 PDCA）。如需分步执行可退出 Code Mode 后重发。',
                    }
                  )
                )
                .catch(() => {
                  // @ignore-catch — 事件广播失败不影响主流程（CS03）
                });
            }
          }
        })
        .catch(() => {
          /* 隐性引擎失败不阻塞消息流 */
        });
    }

    // Phase 2: Telemetry + Trajectory 完成
    if (deps.isTelemetryEnabled()) {
      try {
        agentTelemetry.endTurn(session.id, 'completed');
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // S6: 会话摘要生成（异步，不阻塞消息流）
    if (session.metadata?.projectId) {
      deps.summarizeSession(session, assistantMessage);
    }

    // P4-fix: 等待所有未完成的持久化完成后再返回（WAP 规范）
    await deps.flushPendingPersists();

    // 修复：每完成一次完整 turn 递增计数，确保 turn 编号唯一（否则恒为 turn=1）
    // 设计三：per-session 计数，并发会话互不干扰
    deps.incToolRound(session.id);
    logger.debug('chat:streamFinalize toolRoundCount 递增', {
      sessionId: session.id,
      newValue: deps.getToolRound(session.id),
    });

    return assistantMessage;
  }
}
