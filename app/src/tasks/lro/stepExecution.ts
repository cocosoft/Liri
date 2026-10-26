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

import {
  getToolRegistry,
  globalToolManager,
  findMissingRequiredParams,
} from '../../tools/index.js';
import type { ToolUseContext } from '../../tools/types/Tool.js';
import { emitPdcaLiveEvent } from '../PdcaLiveEvents';
import type { LifecyclePhase } from '../LifecycleTracker';
import { taskOrchestrator } from '../TaskOrchestrator';
import type { Plan, PlanStep } from '../TaskOrchestrator';
import { TaskStatus } from '../types';
import { EXECUTOR_ROLE, normalizeExecutorResult } from './contracts.js';
import type { ExecutorFn, TaskMessage } from './contracts.js';
import { roleToolNames } from './plannerSupport.js';
import { isNonConvergedTermination } from './pureDecisions.js';
import {
  MAX_SECURITY_STEERS_PER_STEP,
  buildCriticalOutcomeEvidence,
  buildSecuritySteeringMessage,
  buildTaorStepResult,
  classifyArtifactAccess,
  describeToolResultFailure,
  isSecurityIntercepted,
  summarizeToolOutcomes,
} from './stepHelpers.js';
import { findWorkspaceEscape } from './workspaceGuard.js';
// LRO-13（2026-10-26）：阻塞命令台账 —— 续跑时同 (命令, cwd, 策略版本) 直接短路，不重放
import {
  blockedReplayResult,
  findBlockedReplay,
  type BlockedCommandCandidateInput,
  type BlockedCommandEntry,
  type BlockedCommandProbeInput,
} from './blockedCommandLedger.js';

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
  /** 注册在飞步骤 loop（返回 release；任务中止时由宿主逐个级联 abort） */
  registerStepLoop: (loop: TAORLoop) => () => void;
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
  /**
   * LRO-13（2026-10-26）：**阻塞命令台账**（宿主持有，随 checkpoint 持久化）。
   *
   * 读：同 `(命令, cwd, 策略版本)` 命中 ⇒ **不执行**，直接返回既有结论；
   * 写：安全门硬拦截（`metadata.securityIntercepted`）的命令入账。
   * 未注入时不启用（保持旧行为，供只跑文本的测试替身）。
   */
  blockedCommands?: {
    find: (probe: BlockedCommandProbeInput) => BlockedCommandEntry | undefined;
    record: (probe: BlockedCommandCandidateInput) => void;
  };
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
  // S4（PR9）/ 2026-10-17：把在飞 loop 登记到宿主集合（任务中止时**逐个**级联 abort）。
  // 返回的 release 在本步收尾时移除登记，避免已完成的 loop 被后续 abort 再打一次。
  const releaseLoop = loop ? deps.registerStepLoop(loop) : undefined;
  if (loop) {
    logger.info('[orchestrator] 进入 TAORLoop 分支（真实工具执行）', {
      taskId: deps.taskId,
      stepId: step.id,
      perStepInstance: deps.hasStepLoopFactory,
      toolNames: roleToolNames(EXECUTOR_ROLE),
    });
    let taorStart = 0;
    /** PR-5：跨轮累计的工具结果（含入参），供结构化总结与审批卡提交 */
    const executedToolResults: Array<{
      toolCallId?: string;
      toolName?: string;
      arguments?: Record<string, unknown>;
      result?: unknown;
      error?: unknown;
    }> = [];
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
              // LRO-13（2026-10-26）：**续跑幂等** —— 同一 (命令, cwd, 策略版本) 已被安全门
              // 判定为不可执行 ⇒ 直接短路，把既有结论交回模型，**不再重放**（拦截是确定性的：
              // 同命令同目录同策略必然得到同一结论，重放只会再撞一次墙）。
              // 放在注册表解析之前：结论来自台账，不依赖该工具此刻是否仍注册。
              const replay = deps.blockedCommands?.find({
                toolName: tc.name,
                args: tc.arguments,
                cwd: deps.isolation.workspace,
              });
              if (replay) {
                results.push(blockedReplayResult(replay, tc));
                logger.warn('[orchestrator] 阻塞命令短路（不重放）', {
                  taskId: deps.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  toolCallId: tc.id,
                  reason: replay.reason,
                  recordedAt: replay.recordedAt,
                  cwd: replay.cwd,
                });
                continue;
              }
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
              // 2026-10-22：必填参数前置校验（与主聊天链 `ToolExecutor.validateInput` 共用同一实现）。
              // 此前本链**直接** `tool.execute()` 绕过校验 ⇒ 参数缺失时工具内部裸抛运行时错误
              // （实测：`file_write` → `The "path" property must be of type string, got undefined`），
              // 模型既不知道缺哪个参数，错误还被下面记成「工具执行成功」。
              const missingParams = findMissingRequiredParams(
                tool.params,
                tc.arguments
              );
              if (missingParams.length > 0) {
                const receivedKeys = Object.keys(tc.arguments ?? {});
                logger.warn('[orchestrator] 工具缺少必填参数，已拒绝执行', {
                  taskId: deps.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  toolCallId: tc.id,
                  missingParams,
                  receivedKeys,
                });
                results.push({
                  toolCallId: tc.id,
                  toolName: tc.name,
                  error:
                    `缺少必填参数 ${missingParams.join('、')}；` +
                    `本次收到的参数键: ${receivedKeys.length > 0 ? receivedKeys.join('、') : '（空）'}。` +
                    '请按工具定义的参数名重新调用（若参数为空，多为参数 JSON 非法或被输出上限截断）。',
                });
                continue;
              }
              const toolResult = await tool.execute(tc.arguments, toolContext);
              // 2026-10-08（steering）：被安全策略拦截的工具名先记账，本轮结束后统一注入改道指令
              if (isSecurityIntercepted(toolResult)) {
                blockedBySecurity.push(tc.name);
              }
              // LRO-13：安全门硬拦截的命令入账（随 checkpoint 持久化）⇒ 续跑短路。
              // 记账门槛（只认 `metadata.securityIntercepted`、只认命令工具）在台账侧判定；
              // 普通工具报错不入账 —— 那不是"确定性撞墙"，重放有意义。
              if (deps.blockedCommands && isSecurityIntercepted(toolResult)) {
                deps.blockedCommands.record({
                  toolName: tc.name,
                  args: tc.arguments,
                  cwd: deps.isolation.workspace,
                  result: toolResult,
                });
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
              // 2026-10-22：结果级失败（未抛错但自述失败）不得记为「成功」/计入 success——
              // 实测 file_write 的错误文案就以 `data` 返回，日志却写「工具执行成功」且 failed:0。
              const resultFailure = describeToolResultFailure(toolResult);
              if (resultFailure) {
                logger.warn('[orchestrator] 工具执行失败（结果级）', {
                  taskId: deps.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  toolCallId: tc.id,
                  elapsedMs: elapsed,
                  errorPreview: resultFailure.slice(0, 200),
                  resultPreview,
                });
              } else {
                logger.info('[orchestrator] 工具执行成功', {
                  taskId: deps.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  toolCallId: tc.id,
                  elapsedMs: elapsed,
                  resultType: typeof toolResult,
                  resultPreview,
                });
              }
              results.push({
                toolCallId: tc.id,
                toolName: tc.name,
                result: toolResult,
                ...(resultFailure ? { error: resultFailure } : {}),
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
          // PR-5：把本轮结果并入**跨轮**累计（带原始入参，供结构化总结与审批卡指纹）
          for (const r of results) {
            const call = toolCalls.find((tc) => tc.id === r.toolCallId);
            executedToolResults.push({
              ...r,
              ...(call ? { arguments: call.arguments } : {}),
            });
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

      // PR-5（2026-10-23）：把本步工具调用汇总为**结构化清单**（成功/失败/拦截/待审批），
      // 并把关键失败行前置进证据（不参与 12×800 窗口截断）。
      const toolOutcomes = summarizeToolOutcomes(executedToolResults);
      const criticalEvidence = buildCriticalOutcomeEvidence(toolOutcomes);
      // PR-5：LRO 直调绕过了权限层 ⇒ 工具自述"需要审批"时**没有任何卡片**可批。
      // 此处补提交 Inbox 卡片（元数据带 pdcaTaskId，批准后回到 `resumeAfterApproval`）。
      await submitStepApprovalCards({
        taskId: deps.taskId,
        sessionId: deps.getSessionId() ?? deps.taskId,
        stepId: step.id,
        executed: executedToolResults,
        summary: toolOutcomes,
      });

      // 执行证据（助手文本 + 工具结果）—— Reviewer 的唯一"实际输出"输入，
      // 只写循环统计会让审查必然判"无证据"（见 buildTaorStepResult 注释）
      const stepEvidence =
        buildTaorStepResult(
          lastMessagesSnapshot,
          {
            turns: result.turnCount,
            tokens: result.totalTokens,
            elapsedMs: taorElapsed,
          },
          criticalEvidence
        ) + readBackEvidence;
      const terminationReason = result.terminationReason;
      if (isNonConvergedTermination(terminationReason)) {
        // U-02（2026-10-19）：预算耗尽但未收敛 ⇒ **不得**记为 completed。
        // 原实现无条件 markStepCompleted ⇒ review 只审 completed 步骤、目标门也可能
        // 看到"步骤全过"而形成假完成。改落 failed 并保留终止原因（resume 扩容续跑据此选候选）。
        taskOrchestrator.markStepFailed(
          step.id,
          `[NON_CONVERGED:${terminationReason}] 步骤未在预算内收敛（turns=${result.turnCount}）`,
          {
            partialOutput: stepEvidence,
            terminationReason,
            toolOutcomes,
          }
        );
      } else {
        taskOrchestrator.markStepCompleted(step.id, stepEvidence, {
          // E1①（2026-09-05，方案甲）：终止原因透传落 PlanStep
          terminationReason,
          toolOutcomes,
          // LRO-12（2026-10-26）：产物台账（**空数组也传**）⇒ 进度只由产物存在性推进；
          // 本步跑了但没写出任何文件时不推进进度，避免"步骤打勾即完成"的假进度
          artifacts: [...writtenPaths],
        });
      }
      await deps.persistCheckpoint(); // P0(M2)
      const log = (loop as any).getLastRunLog?.();
      const dur = deps.stepDurations.get(step.id);
      if (dur) dur.endMs = Date.now();
      const stepElapsed = dur && dur.endMs ? dur.endMs - dur.startMs : -1;
      logger.info('[orchestrator] TAORLoop 步骤收尾', {
        taskId: deps.taskId,
        stepId: step.id,
        status: isNonConvergedTermination(terminationReason)
          ? 'failed(non_converged)'
          : 'completed',
        terminationReason,
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
          // U-02：非收敛步骤如实上报 failed（不再冒充满分完成）
          status: isNonConvergedTermination(terminationReason)
            ? 'failed'
            : 'completed',
          stepId: step.id,
          // 2026-10-17：进度口径改为"真正 completed 的步骤数"（原用 stepDurations.size，
          // 该 Map 在步骤**开始**时写入 ⇒ 进度虚高）
          completedSteps: plan.steps.filter((s) => s.status === 'completed')
            .length,
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
    } finally {
      // 本步 loop 已结束（成功/中止/降级）⇒ 从在飞集合移除，避免后续 abort 再打一次
      releaseLoop?.();
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

/**
 * PR-5（2026-10-23）：为"工具要求人工审批"的调用补提交 Inbox 卡片。
 *
 * 为什么需要：LRO 步骤内的工具直调**绕过权限层**（任务启动即视为用户授权），
 * 但工具自身仍可能返回 `requireApproval`（bash AST 不确定 / media 删除等）。
 * 此前这样的调用没有任何卡片可批 ⇒ 审查门只能判"未产出" ⇒ retry/escalate。
 *
 * 元数据与 `PermissionChecker._submitToInbox` 同形（同指纹 hash ⇒ 批准后工具重发命中
 * 放行缓存），并额外带 `pdcaTaskId`：批准后由 `inboxApproval` 回到
 * `LongRunningTaskOrchestrator.resumeAfterApproval` 续跑挂起步骤。
 *
 * 失败仅告警（审批卡缺失不应让步骤执行本身崩掉）。
 */
async function submitStepApprovalCards(args: {
  taskId: string;
  sessionId: string;
  stepId: string;
  executed: ReadonlyArray<{
    toolCallId?: string;
    toolName?: string;
    arguments?: Record<string, unknown>;
    result?: unknown;
  }>;
  summary: ReturnType<typeof summarizeToolOutcomes>;
}): Promise<void> {
  const pending = args.summary.outcomes.filter((o) => o.pendingApproval);
  if (pending.length === 0) return;
  try {
    const { inboxManager } = await import('@modules/runtime/InboxManager.js');
    const {
      hashCommandForExecution,
      hashApprovalFingerprint,
      resolveApprovalFingerprint,
      previewApprovalFingerprint,
      findPendingApprovalId,
    } = await import('@modules/permission');

    for (const outcome of pending) {
      const call = args.executed.find(
        (r) =>
          r.toolName === outcome.toolName &&
          (!outcome.toolCallId || r.toolCallId === outcome.toolCallId)
      );
      const input = call?.arguments ?? {};
      const fingerprint = resolveApprovalFingerprint(outcome.toolName, input);
      const commandHash = hashCommandForExecution(fingerprint);
      const command = typeof input.command === 'string' ? input.command : '';

      const existingId = await findPendingApprovalId(inboxManager, {
        sessionId: args.sessionId,
        toolName: outcome.toolName,
        approvalHash: commandHash,
      });
      if (existingId) {
        logger.info('[orchestrator] 步骤审批卡已存在，复用', {
          taskId: args.taskId,
          stepId: args.stepId,
          toolName: outcome.toolName,
          inboxItemId: existingId,
        });
        continue;
      }

      await inboxManager.submit({
        sessionId: args.sessionId,
        type: 'approval',
        title: `工具审批: ${outcome.toolName}`,
        message: `工具 '${outcome.toolName}' 请求执行（PDCA 步骤）\n${
          command
            ? `命令: ${command}`
            : `参数: ${JSON.stringify(input).slice(0, 300)}`
        }`,
        options: ['approve', 'approve_session', 'deny'],
        offlineCapable: true,
        source: 'permission',
        metadata: {
          toolName: outcome.toolName,
          taskId: args.taskId,
          stepId: args.stepId,
          commandHash,
          approvalFingerprintHash: hashApprovalFingerprint(fingerprint),
          approvalFingerprintPreview: previewApprovalFingerprint(fingerprint),
          approvalScopeKind: 'once',
          command: command || undefined,
          inputPreview: JSON.stringify(input).slice(0, 200),
          /** PR-5：批准后由 inboxApproval 回到 PDCA（步骤级挂起恢复） */
          pdcaTaskId: args.taskId,
          ...(outcome.approvalReason
            ? { approvalReason: outcome.approvalReason }
            : {}),
        },
      });
      logger.info('[orchestrator] 已提交步骤审批卡', {
        taskId: args.taskId,
        stepId: args.stepId,
        toolName: outcome.toolName,
      });
    }
  } catch (e) {
    logger.warn('[orchestrator] 步骤审批卡提交失败（不阻塞步骤收尾）', {
      taskId: args.taskId,
      stepId: args.stepId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
