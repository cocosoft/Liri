// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stepExecution —— PDCA 单步执行主链（LRO 拆分批 U-22/S2b）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `executeSingleStep`（562 行）。
 *
 * **职责（单一：执行一个 PlanStep 并落状态/证据/消息）**：
 *   ① TAORLoop 分支（真实工具执行 + 写后读回机械保障 + 安全拦截改道 steering）；
 *   ② 默认 executor 分支（无工具能力，仅有界重试 + 超限 escalate）；
 *   ③ 中止语义：按 cancelled 收尾，不重试、不告警。
 *
 * **行为等价**：执行提示词三段（步骤/验收/上次问题 + 三条硬约束）、日志文案与级别、
 * 工具安全语义（未注册 / 路径越界 / 安全拦截上限）、证据并入与升级路径**逐字未变**。
 */

import { getLogger } from '@modules/monitoring';
import type { AgentIsolation } from '@modules/agent';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { createTAORLoopDeps } from '@modules/query';
import type { TAORLoop } from '@modules/query';

import { getToolRegistry, globalToolManager } from '../../tools/index.js';
import type { ToolUseContext } from '../../tools/types/Tool.js';
import { emitPdcaLiveEvent } from '../PdcaLiveEvents';
import type { LifecyclePhase } from '../LifecycleTracker';
import { taskOrchestrator } from '../TaskOrchestrator';
import type { Plan, PlanStep } from '../TaskOrchestrator';
import { TaskStatus } from '../types';
import { EXECUTOR_ROLE, normalizeExecutorResult } from './contracts.js';
import type { ExecutorFn, TaskMessage } from './contracts.js';
import { roleToolNames } from './plannerSupport.js';
import {
  MAX_SECURITY_STEERS_PER_STEP,
  buildSecuritySteeringMessage,
  buildTaorStepResult,
  classifyArtifactAccess,
  isSecurityIntercepted,
} from './stepHelpers.js';
import { findWorkspaceEscape } from './workspaceGuard.js';

const logger = getLogger('tasks:longRunning');

export interface StepExecutionDeps {
  taskId: string;
  isolation: AgentIsolation;
  executor: ExecutorFn;
  createToolContext: () => ToolUseContext;
  /** 串行回退实例（未注入工厂时使用） */
  getSharedLoop: () => TAORLoop | undefined;
  /** 是否注入了每步独立实例工厂（决定走工厂还是共享实例） */
  hasStepLoopFactory: boolean;
  /** 每步独立实例工厂（并行安全） */
  createStepLoop: (
    taskId: string,
    opts: { privateInstance: boolean; maxTurnsMultiplier?: number }
  ) => TAORLoop | undefined;
  /** 记录当前步骤 loop（任务中止时级联 abort） */
  setCurrentLoop: (loop: TAORLoop | undefined) => void;
  /** 步骤轮次预算乘子（resume 扩容续跑时 > 1） */
  stepTurnsMultiplier: number;
  stepDurations: Map<
    string,
    { startMs: number; endMs?: number; tokens?: number }
  >;
  /** 累计 TAORLoop token（阶段边界结算数据源） */
  addTotalTokens: (tokens: number) => void;
  readBackWrittenArtifacts: (
    written: ReadonlySet<string>,
    alreadyRead: ReadonlySet<string>
  ) => Promise<string>;
  recordEscalation: (step: PlanStep) => Promise<void>;
  emitTaskMessage: (msgs: TaskMessage[]) => void;
  recordLifecycle: (
    phase: LifecyclePhase,
    status: TaskStatus,
    detail?: string
  ) => void;
  persistCheckpoint: () => Promise<void>;
  getPlanId: () => string | null;
  getSessionId: () => string | null;
}

export async function executeSingleStep(
  step: PlanStep,
  plan: Plan,
  deps: StepExecutionDeps
): Promise<void> {
  taskOrchestrator.markStepRunning(step.id);
  await deps.persistCheckpoint(); // P0(M2)：步骤状态变更即落盘
  deps.stepDurations.set(step.id, { startMs: Date.now() });
  deps.recordLifecycle(
    'progress',
    TaskStatus.RUNNING,
    `Executing step: ${step.description}`
  );

  logger.info('[orchestrator] executeSingleStep 开始', {
    taskId: deps.taskId,
    planId: plan.id,
    stepId: step.id,
    stepDesc: step.description.slice(0, 80),
    hasTAORLoop: !!deps.getSharedLoop(),
    hasAcceptanceCriteria: !!step.acceptanceCriteria,
    hasReviewResult: !!step.reviewResult,
    retryCount: step.retryCount,
    maxRetries: step.maxRetries,
  });

  if (step.retryCount > 0) {
    logger.info('[orchestrator] 执行重试步骤', {
      taskId: deps.taskId,
      stepId: step.id,
      retryCount: step.retryCount,
      maxRetries: step.maxRetries,
      hasReviewResult: !!step.reviewResult,
      reviewIssues: step.reviewResult?.issues
        ?.slice(0, 3)
        .map((i) => i.description),
    });
  }

  const execPrompt = [
    `执行以下步骤: ${step.description}`,
    step.acceptanceCriteria ? `验收标准: ${step.acceptanceCriteria}` : '',
    step.reviewResult
      ? `注意: 上次审查发现以下问题，本次请修正：\n${step.reviewResult.issues.map((i) => `- ${i.description}`).join('\n')}`
      : '',
    // U-08 / LRO-08 / LRO-16（2026-10-17）：步骤级硬约束。
    [
      '【硬约束】',
      '- 不得向用户提问、请求确认或等待用户答复；信息不足时基于现有信息做可回退的最小决策，并在结果中写明假设。',
      '- 不得以 shell 管道（|）、逻辑与（&&）、逻辑或（||）作为判定动作；需要多步时逐次调用工具并说明结果。',
      '- 交付声明必须区分“已实测（附命令/输出证据）”与“未实测”；未实测时禁止使用“完成/已交付/可直接使用”等措辞，应明确标注未验证项。',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  // Phase 2: 委托 TAORLoop 编排（统一编排已常驻；开关 ENABLE_LOOP_V8_PHASE2 已退役——L5 清理 2026-09-06）
  // D2（M3，2026-08-13）：优先每步独立实例（工厂注入，并行安全）；否则共享实例（串行）
  const sharedLoop = deps.getSharedLoop();
  const loop = deps.hasStepLoopFactory
    ? deps.createStepLoop(deps.taskId, {
        // S1/PR9 私有化：LRTO 步骤始终要全新私有实例（不进会话缓存）
        privateInstance: true,
        // S2/B（PR9）：扩容续跑乘子透传工厂（翻倍轮次预算）
        maxTurnsMultiplier:
          deps.stepTurnsMultiplier > 1 ? deps.stepTurnsMultiplier : undefined,
      })
    : sharedLoop;
  // S4（PR9）：记录当前步骤 loop，任务中止时级联 abort（私有实例可安全中止）
  deps.setCurrentLoop(loop);
  if (loop) {
    logger.info('[orchestrator] 进入 TAORLoop 分支（真实工具执行）', {
      taskId: deps.taskId,
      stepId: step.id,
      perStepInstance: deps.hasStepLoopFactory,
      toolNames: roleToolNames(EXECUTOR_ROLE),
    });
    let taorStart = 0;
    try {
      const isolation = deps.isolation;
      const executor = deps.executor;
      const taskId = deps.taskId;
      (loop as any).config.sessionId = deps.taskId;

      // 持久化缓冲区（PDCA 模式下保持消息上下文）
      const persistedMessages: any[] = [];
      // 本轮**最终**消息快照（TAORLoop 每轮传全量 `this.messages`，故最后一次即完整对话）
      let lastMessagesSnapshot: any[] = [];
      // 2026-10-08（机械保障）：本步的产物读写台账 —— 用于"写后读回"补做
      const writtenPaths = new Set<string>();
      const readPaths = new Set<string>();
      // 2026-10-08（steering）：本步已注入的"改道"次数（上限见 MAX_SECURITY_STEERS_PER_STEP）
      let securitySteerCount = 0;

      const taorDeps = createTAORLoopDeps({
        callModel: async function* (msgs: any[], signal: AbortSignal) {
          // 构建完整对话上下文（修复：之前只取最后一条消息）
          const conversationContext = msgs
            .map((m) =>
              typeof m.content === 'string'
                ? `[${m.role}] ${m.content}`
                : `[${m.role}] ${JSON.stringify(m.content)}`
            )
            .join('\n\n');
          const callStart = Date.now();
          const result = normalizeExecutorResult(
            await executor({
              systemPrompt: EXECUTOR_ROLE.systemPrompt,
              userPrompt: execPrompt + '\n\n' + conversationContext,
              tools: roleToolNames(EXECUTOR_ROLE),
              taskType: EXECUTOR_ROLE.taskType,
              isolation,
            })
          );
          const callElapsed = Date.now() - callStart;
          logger.info('[orchestrator] callModel 完成', {
            taskId,
            stepId: step.id,
            elapsedMs: callElapsed,
            resultLength: result.content.length,
            toolCallCount: result.toolCalls.length,
            msgCount: msgs.length,
          });
          if (result.content) {
            yield { type: 'text', content: result.content };
          }
          // 工具调用须以**单数** `toolCall` 逐块 yield —— `TAORLoop._collectCallModel`
          // 正是按 `chunk.toolCall` 聚合成 `tool_calls`（复数）。此前只 yield 文本
          // ⇒ `executeTools` 结构性不可达（事故指纹：callModel 完成 84 / executeTools 开始 0）。
          for (const tc of result.toolCalls) {
            yield { type: 'tool_call', toolCall: tc };
          }
          yield { type: 'done' };
        },
        executeTools: async (
          toolCalls: Array<{
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          }>,
          _signal: AbortSignal
        ) => {
          // RC-C 修复：真实工具执行（替代 LLM 模拟）
          // 复用对话侧 ToolExecutor，豁免审批（任务启动即用户授权）
          const toolContext = deps.createToolContext();
          const executeToolsStart = Date.now();
          const results: Array<{
            toolCallId?: string;
            toolName?: string;
            result?: unknown;
            error?: string;
          }> = [];
          /** 本轮被安全策略拦截的工具名（用于事后注入改道 steering） */
          const blockedBySecurity: string[] = [];
          logger.info('[orchestrator] executeTools 开始执行', {
            taskId: deps.taskId,
            stepId: step.id,
            toolCount: toolCalls.length,
            toolNames: toolCalls.map((tc) => tc.name),
          });
          for (const tc of toolCalls) {
            const toolStart = Date.now();
            try {
              // 模型回传的是 **wire 安全名**（`calendar_add`），注册表登记的是真名
              // （`calendar:add`）；`getTool()` 内置别名解析（注册期为非 wire 安全名
              // 自动登记 wire 别名），故必须经注册表而非直接比对 `tool.name`。
              const tool = getToolRegistry().getTool(tc.name);
              if (!tool) {
                logger.warn('[orchestrator] 工具未注册', {
                  taskId: deps.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  toolCallId: tc.id,
                  registeredTools: globalToolManager
                    .getAllTools()
                    .map((t) => t.name),
                });
                results.push({
                  toolCallId: tc.id,
                  toolName: tc.name,
                  error: `工具未注册: ${tc.name}`,
                });
                continue;
              }
              // U-03b / U-09（2026-10-17）：工具路径入参必须落在 LRO 隔离工作区内；
              // 越界（绝对路径或 `../`）直接拒绝，避免读系统目录/写项目根。
              const escape = findWorkspaceEscape(
                deps.isolation.workspace,
                tc.arguments
              );
              if (escape) {
                logger.warn('[orchestrator] 工具路径越界，已拒绝执行', {
                  taskId: deps.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  argKey: escape.key,
                  argValue: escape.value,
                  resolved: escape.resolved,
                  workspace: deps.isolation.workspace,
                });
                results.push({
                  toolCallId: tc.id,
                  toolName: tc.name,
                  error:
                    `路径越界：${escape.key}=${escape.value} 不在任务工作区内；` +
                    '请改用工作区内相对路径。',
                });
                continue;
              }
              const toolResult = await tool.execute(tc.arguments, toolContext);
              // 2026-10-08（steering）：被安全策略拦截的工具名先记账，本轮结束后统一注入改道指令
              if (isSecurityIntercepted(toolResult)) {
                blockedBySecurity.push(tc.name);
              }
              // 2026-10-08（机械保障 · 写后读回）：登记本步的产物读写台账。
              // 仅在**调用未报错**时登记（失败调用不构成"已写入/已读回"）。
              {
                const access = classifyArtifactAccess(tc.name, tc.arguments);
                const tr = toolResult as
                  | { success?: boolean; error?: string }
                  | null
                  | undefined;
                const ok =
                  !!tr && tr.error === undefined && tr.success !== false;
                if (access && ok) {
                  (access.kind === 'write' ? writtenPaths : readPaths).add(
                    access.path
                  );
                }
              }
              const elapsed = Date.now() - toolStart;
              const resultPreview: string =
                typeof toolResult === 'string'
                  ? (toolResult as string).slice(0, 100)
                  : typeof toolResult === 'object' && toolResult !== null
                    ? JSON.stringify(toolResult).slice(0, 100)
                    : String(toolResult).slice(0, 100);
              logger.info('[orchestrator] 工具执行成功', {
                taskId: deps.taskId,
                stepId: step.id,
                toolName: tc.name,
                toolCallId: tc.id,
                elapsedMs: elapsed,
                resultType: typeof toolResult,
                resultPreview,
              });
              results.push({
                toolCallId: tc.id,
                toolName: tc.name,
                result: toolResult,
              });
            } catch (e) {
              const elapsed = Date.now() - toolStart;
              await handleError(e, {
                module: 'tasks:longRunning',
                action: 'executeTools',
                context: {
                  toolName: tc.name,
                  stepId: step.id,
                  toolCallId: tc.id,
                  elapsedMs: elapsed,
                },
              });
              results.push({
                toolCallId: tc.id,
                toolName: tc.name,
                error: String(e),
              });
            }
          }
          logger.info('[orchestrator] executeTools 执行完毕', {
            taskId: deps.taskId,
            stepId: step.id,
            total: results.length,
            success: results.filter((r) => !r.error).length,
            failed: results.filter((r) => r.error).length,
            failedNames: results.filter((r) => r.error).map((r) => r.toolName),
            totalElapsedMs: Date.now() - executeToolsStart,
          });

          // 2026-10-08（steering · 机械改道）：有调用被安全策略拦截 ⇒ **不中断**当前步，
          // 只向循环队列注入一条改道指令，令模型**下一轮**改用专用工具（拦截本身已硬拒、
          // 没有任何副作用被执行）。上限 `MAX_SECURITY_STEERS_PER_STEP` 防 runaway。
          if (
            blockedBySecurity.length > 0 &&
            securitySteerCount < MAX_SECURITY_STEERS_PER_STEP
          ) {
            securitySteerCount++;
            loop.injectSteering(
              buildSecuritySteeringMessage(blockedBySecurity),
              'orchestrator'
            );
            logger.warn(
              '[orchestrator] 工具调用被安全策略拦截 ⇒ 注入 steering 令其改道',
              {
                taskId: deps.taskId,
                stepId: step.id,
                blocked: [...new Set(blockedBySecurity)],
                steerCount: securitySteerCount,
                maxSteers: MAX_SECURITY_STEERS_PER_STEP,
              }
            );
          }
          return results;
        },
        persistMessages: async (msgs: any[], _signal?: AbortSignal) => {
          // 缓存消息到内存，PDCA 完成后统一持久化
          persistedMessages.push(...msgs);
          lastMessagesSnapshot = msgs;
        },
      });

      const messages: any[] = [{ role: 'user', content: execPrompt }];
      taorStart = Date.now();
      const result = await loop.runCollect({
        messages: messages as never,
        deps: taorDeps,
      } as never);
      const taorElapsed = Date.now() - taorStart;
      // S2（2026-08-13）：累计 TAORLoop token，阶段边界结算落库 goal_metrics
      // 1-1d（2026-09-03）：每步独立记账（跨 retry 累计）+ 聚合单值双写。
      // 并发安全依据：本结算点为无 await 的同步语句，事件循环下 += 不丢更新；
      // stepDurations[].tokens 提供 per-step 明细，供审计/评估集聚合校验。
      deps.addTotalTokens(result.totalTokens);
      const stepTok = deps.stepDurations.get(step.id);
      if (stepTok) {
        stepTok.tokens = (stepTok.tokens ?? 0) + result.totalTokens;
      }

      // 2026-10-08（机械保障 · 写后读回）：提示词层引导**不可靠** —— 真机实测执行器常漏做
      // 读回，审查（正确地）判"验收标准未被实际验证"⇒ 步骤 failed。此处由编排器**机械补做**：
      // 对本步成功写入、但本步内未被读回的产物，各补一次**只读**的读回并原样并入步骤证据
      // （明确标注"编排器补做"，不冒充模型行为）。
      const readBackEvidence = await deps.readBackWrittenArtifacts(
        writtenPaths,
        readPaths
      );

      taskOrchestrator.markStepCompleted(
        step.id,
        // 执行证据（助手文本 + 工具结果）—— Reviewer 的唯一"实际输出"输入，
        // 只写循环统计会让审查必然判"无证据"（见 buildTaorStepResult 注释）
        buildTaorStepResult(lastMessagesSnapshot, {
          turns: result.turnCount,
          tokens: result.totalTokens,
          elapsedMs: taorElapsed,
        }) + readBackEvidence,
        // E1①（2026-09-05，方案甲）：终止原因透传落 PlanStep
        { terminationReason: result.terminationReason }
      );
      await deps.persistCheckpoint(); // P0(M2)
      const log = (loop as any).getLastRunLog?.();
      const dur = deps.stepDurations.get(step.id);
      if (dur) dur.endMs = Date.now();
      const stepElapsed = dur && dur.endMs ? dur.endMs - dur.startMs : -1;
      logger.info('[orchestrator] TAORLoop 步骤完成', {
        taskId: deps.taskId,
        stepId: step.id,
        turns: result.turnCount,
        totalTokens: result.totalTokens,
        taorElapsedMs: taorElapsed,
        stepElapsedMs: stepElapsed,
        persistedMsgCount: persistedMessages.length,
        taorResult: log,
      });
      // OBS（M1b）：经典链步骤完成 → pdca:stage:phase（独立通道，非会话消息）
      void emitPdcaLiveEvent(
        'pdca:stage:phase',
        {
          taskId: deps.taskId,
          planId: deps.getPlanId() ?? undefined,
          sessionId: deps.getSessionId() ?? '',
        },
        {
          stage: 'execute',
          status: 'completed',
          stepId: step.id,
          completedSteps: deps.stepDurations.size,
          totalSteps: plan.steps.length,
          tokenCost: result.totalTokens,
          durationMs: taorElapsed,
          currentStep: step.description.slice(0, 80),
        }
      );
      // §5 P1: 消费死缓冲 — step 完成后批量回写（此前 persistedMessages 只 push 从未消费）
      if (persistedMessages.length > 0) {
        deps.emitTaskMessage(
          persistedMessages.slice(-10).map((m) => ({
            // P2（08-09）：保留原始 role（不再强制伪装为 assistant）
            role: (m.role === 'user' || m.role === 'tool'
              ? m.role
              : 'assistant') as TaskMessage['role'],
            content:
              typeof m.content === 'string'
                ? m.content.slice(0, 500)
                : JSON.stringify(m.content).slice(0, 500),
            toolCallId: m.toolCallId as string | undefined,
          }))
        );
      }
      return;
    } catch (e) {
      // PR3（#3）：中止引发 → 按 cancelled 收尾并终止该步骤（不再降级重试/告警）
      if (deps.isolation.abortController.signal.aborted) {
        logger.info('[orchestrator] TAOR 步骤因中止取消', {
          taskId: deps.taskId,
          stepId: step.id,
        });
        taskOrchestrator.markStepCancelled(step.id, '用户中止');
        await deps.persistCheckpoint();
        return;
      }
      const taorElapsedOnFail = Date.now() - taorStart;
      await handleError(e, {
        module: 'tasks:longRunning',
        action: 'taorLoop_delegation',
        context: { stepId: step.id },
      });
      logger.warn('[orchestrator] TAORLoop 执行失败，降级到默认 executor', {
        taskId: deps.taskId,
        stepId: step.id,
        stepDesc: step.description.slice(0, 60),
        elapsedMs: taorElapsedOnFail,
        error: String(e),
        errorType: e instanceof Error ? e.constructor.name : typeof e,
      });
    }
  }

  // 默认路径：直接调用 executor
  logger.info('[orchestrator] 进入默认 executor 路径（纯 LLM 文本执行）', {
    taskId: deps.taskId,
    stepId: step.id,
    hasTAORLoop: !!deps.getSharedLoop(),
  });
  try {
    const executorStart = Date.now();
    const executed = normalizeExecutorResult(
      await deps.executor({
        systemPrompt: EXECUTOR_ROLE.systemPrompt,
        userPrompt: execPrompt,
        tools: roleToolNames(EXECUTOR_ROLE),
        taskType: EXECUTOR_ROLE.taskType,
        isolation: deps.isolation,
      })
    );
    // 本路径**无工具执行能力**（无 TAORLoop）：模型若仍请求了工具，如实告警而非静默丢弃
    // （2026-10-08：注册 `setStepLoopFactory` 后生产不再走此路径；仅启动早期/测试可达）
    if (executed.toolCalls.length > 0) {
      logger.warn(
        '[orchestrator] 无 TAORLoop ⇒ 步骤工具调用无法执行（已丢弃）',
        {
          taskId: deps.taskId,
          stepId: step.id,
          toolNames: executed.toolCalls.map((tc) => tc.name),
          hint: '未注册步骤 TAORLoop 工厂（setStepLoopFactory）',
        }
      );
    }
    const result = executed.content;
    const executorElapsed = Date.now() - executorStart;

    taskOrchestrator.markStepCompleted(step.id, result);
    await deps.persistCheckpoint(); // P0(M2)
    const dur = deps.stepDurations.get(step.id);
    if (dur) dur.endMs = Date.now();
    const stepElapsed = dur && dur.endMs ? dur.endMs - dur.startMs : -1;

    logger.info('[orchestrator] 默认 executor 步骤完成', {
      taskId: deps.taskId,
      stepId: step.id,
      executorElapsedMs: executorElapsed,
      stepElapsedMs: stepElapsed,
      resultLength: result.length,
    });

    // §5 P1: 默认路径从零建立消息记录（此前直接 executor 路径无任何消息回写）
    deps.emitTaskMessage([
      {
        role: 'assistant',
        content: `[任务步骤完成] ${step.description}\n${(result || '').slice(0, 500)}`,
      },
    ]);

    deps.recordLifecycle(
      'progress',
      TaskStatus.RUNNING,
      `Step completed: ${step.description}`
    );
  } catch (e) {
    // PR3（#3）：中止引发 → 按 cancelled 收尾，不标 failed、不告警
    if (deps.isolation.abortController.signal.aborted) {
      logger.info('[orchestrator] executor 步骤因中止取消', {
        taskId: deps.taskId,
        stepId: step.id,
      });
      taskOrchestrator.markStepCancelled(step.id, '用户中止');
      await deps.persistCheckpoint();
      return;
    }
    const errMsg = e instanceof Error ? e.message : String(e);
    const maxRetries = step.maxRetries ?? 3;
    if (step.retryCount < maxRetries) {
      // PR5（#5，2026-09-05）：执行级有界重试——瞬时工具/网络异常不直接终态 failed。
      // 复用 decide-retry 同一 retryCount 语义；重试在下一轮 executeAllSteps 中再次执行。
      step.status = 'pending';
      step.retryCount += 1;
      step.error = errMsg;
      deps.recordLifecycle(
        'progress',
        TaskStatus.RUNNING,
        `执行异常，重试 #${step.retryCount}/${maxRetries}: ${step.description}`
      );
      logger.info('[orchestrator] 步骤执行异常，进入有界重试', {
        taskId: deps.taskId,
        stepId: step.id,
        stepDesc: step.description.slice(0, 60),
        retryCount: step.retryCount,
        maxRetries,
        error: errMsg.slice(0, 200),
      });
      await deps.persistCheckpoint();
      return;
    }
    // 超限 → 升级 escalate（缺陷落 _lastEscalations → replan 通道；与 #5/#6 验收口径一致）
    step.status = 'failed';
    step.decision = 'escalate';
    step.error = `Exceeded max retries (${maxRetries}): ${errMsg}`;
    await deps.recordEscalation(step);
    await handleError(
      new AppError(
        step.error,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PDCA_STEP_EXECUTION_EXHAUSTED',
        { taskId: deps.taskId, stepId: step.id, maxRetries }
      ),
      { module: 'tasks:longRunning', action: 'executor_exhausted' }
    );
    taskOrchestrator.markStepFailed(step.id, step.error);
    await deps.persistCheckpoint(); // P0(M2)
    // §5 P1: 失败也回写执行摘要
    deps.emitTaskMessage([
      {
        role: 'assistant',
        content: `[任务步骤失败] ${step.description} — ${step.error}`,
      },
    ]);
    const dur = deps.stepDurations.get(step.id);
    if (dur) dur.endMs = Date.now();

    deps.recordLifecycle(
      'progress',
      TaskStatus.RUNNING,
      `Step failed (escalated): ${step.description} — ${step.error}`
    );
  }
}
