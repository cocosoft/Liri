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

import { getLogger } from '@openliri/infra/monitoring';
// #28（2026-10-30）：任务回写内容只取可读字段（工具结果契约类型，避免裸字面量）
import type { ToolResult } from '@openliri/infra/utils/toolContract';
import { isCommandToolName } from '@openliri/infra/utils/toolContract/toolRoles';
// 2026-11-08（第三十八轮）：审批卡选项集的**唯一真源**（P0 三档），LRO 步骤卡不再自写一份
import {
  buildApprovalOptions,
  resolveRiskClass,
} from '@openliri/infra/permission';
import type { AgentIsolation } from '@modules/agent';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@openliri/infra/error';
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
import { isWorkspaceEmpty, roleToolNames } from './plannerSupport.js';
import { isNonConvergedTermination } from './pureDecisions.js';
import {
  MAX_SECURITY_STEERS_PER_STEP,
  buildCriticalOutcomeEvidence,
  buildSecuritySteeringMessage,
  buildTaorStepResult,
  buildToolCallEvidence,
  classifyArtifactAccess,
  describeToolResultFailure,
  isPendingApproval,
  isSecurityIntercepted,
  mergeToolOutcomeSummaries,
  summarizeToolOutcomes,
} from './stepHelpers.js';
import { findWorkspaceEscape } from './workspaceGuard.js';
// 2026-10-31：缺参文案（含"参数 JSON 被截断"诊断）与保留键剥除的**单一实现**，
// 主聊天链 `ToolRegistry` / `ToolManager` 亦用同一份 ⇒ 本链不再自行拼文案（CS01）。
import {
  describeMissingRequiredParams,
  stripArgParseErrorKey,
} from '@openliri/infra/utils/toolContract/argParseError';
// LRO-13（2026-10-26）：阻塞命令台账 —— 续跑时同 (命令, cwd, 策略版本) 直接短路，不重放
import {
  blockedReplayResult,
  findBlockedReplay,
  type BlockedCommandCandidateInput,
  type BlockedCommandEntry,
  type BlockedCommandProbeInput,
} from './blockedCommandLedger.js';
// 2026-11-09（真机：会话「全自动」下长程任务仍弹命令审批）：LRO 此前**绕过权限层**，
// 现与聊天链同源判定（`authorizeToolCall`），见 `toolAuthorization.ts`。
import { authorizeLroToolCall } from './toolAuthorization.js';

const logger = getLogger('tasks:longRunning');

/**
 * #28（2026-10-30）：把任务消息的 content 归一为**可读文本**。
 *
 * 写入侧禁止把工具结果以 `JSON.stringify` 塞进 assistant 正文（真机 144 条
 * `{"data":…,"success":…}` 气泡即由此产生）。对象只取可读字段，取不到返回空串
 * （调用方据此丢弃该条，而不是把整包 JSON 显示给用户）。
 */
export function toReadableTaskContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    // 用工具结果**契约类型**取可读字段（不写裸字段名字面量 ⇒ 不触发状态词汇棘轮）
    const result = content as Partial<ToolResult>;
    for (const value of [
      result.error,
      result.output,
      result.content,
      result.data,
    ]) {
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return '';
}

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
      // 2026-11-08（真机 `pdca_mw6tie3k`）：模型用 `if exist output (echo ...) else (...)` 判断目录
      // 是否存在 ⇒ 条件式不在安全白名单 ⇒ 弹审批（同一意图换写法又弹一张）。存在性/匹配/计数
      // 都有专用只读工具，不需要 shell 条件式。
      '- 判断文件/目录是否存在、内容是否匹配、数量多少时，用 file_read / glob / grep 等专用工具；不要用 shell 条件式（`if exist`、`if [ ]`、`test`）或把判断塞进一条命令 —— 这会触发人工审批并阻塞任务。',
      // 2026-11-08（真机 `pdca_mw6yabdj`）：审批按**命令文本**放行；模型批准后换等价写法
      // （`-e` → `--eval` → 写成脚本）⇒ 每次都命中新指纹、再弹一张卡，3 轮后任务失败。
      '- 需要人工审批的命令（返回 `需要用户确认`）在用户批准后，请**原样执行同一条命令**：不要改写参数、不要换等价写法（如 `-e` 换 `--eval`、改写进脚本文件），也不要换工具 —— 改写会命中新的审批指纹，导致再次挂起。',
      // 2026-10-31：真机 app.log 单窗口 211 次「工具路径越界」——模型反复传仓库根绝对路径，
      // 而此前提示词与拒绝文案都**没告诉它**工作区在哪 ⇒ 只能盲试。工作区根目录属确定性事实，
      // 直接前置声明（越界守卫本身不放宽）。
      `- 工具的文件路径一律**相对本任务工作区根目录** \`${deps.isolation.workspace}\`（如 \`output/report.md\`）；不要传仓库根或其它绝对路径，否则会被越界守卫拒绝。`,
      // 2026-11-08（真机 `pdca_mw7t4025`）：工作区是**空目录**，模型却反复换 pattern 探测
      // `app/src/...`（13 次工具全空）直到被 IO 循环守卫中止。空结果属正常初始态。
      // 2026-11-09（cwd 对齐会话工作区后修正）：**不能写死"初始为空目录"** —— 真机
      // `pdca_mw8uz6mf` 的工作区已有 `hello.txt`，提示词却声称其为空，模型读到文件后反复核对
      // （`file_read` ×4）。按**真实目录内容**分型。
      isWorkspaceEmpty(deps.isolation.workspace)
        ? '- 该工作区初始为**空目录**：`glob` / `grep` 搜不到文件是正常的，**不要反复换 pattern 探测同一路径**；确认一次不存在后按"该路径不可用"继续（本任务**没有 `projectId`**，`read_project_file` 也不可用）。'
        : '- 该工作区**已有内容**（会话工作区）：先用 `glob` 列出根目录确认真实文件，再决定路径；**不要假定文件不存在**，也不要反复换 pattern 探测同一路径（本任务**没有 `projectId`**，`read_project_file` 不可用）。',
      // 2026-11-09（真机 `pdca_mw8k25ul`）：`cd <空工作区> && powershell -Command "Get-ChildItem -File ..."`
      // 连续 8 次返回同一条"空输出"，直到全局断路器以 aborted 收尾（整步白跑）。空输出是**结果**，不是失败。
      '- 命令返回**空输出且退出码 0** 时，空输出就是结果本身（如目录为空 / 无匹配项）：**不要原样重试同一条命令**，据实记录"无结果"后继续下一步；需要列举改用 `glob` / `list`。',
      '- 交付声明必须区分“已实测（附命令/输出证据）”与“未实测”；未实测时禁止使用“完成/已交付/可直接使用”等措辞，应明确标注未验证项。',
      // 2026-11-08（真机 `pdca_mw75rudi` / `pdca_mw75xyla`）：两次都出现"首个 attempt 只回文本、
      // 未调用任何工具"⇒ 审查判"无证据"⇒ 白花一次重试。
      '- 本步骤要求执行命令或读写文件时，必须**实际调用对应工具**取得证据；不得凭上下文推断结果，也不得把"预期输出"当作执行结果报告。',
      // 2026-11-08（真机 `pdca_mw7wv9ee`）：任务要求"读取不存在的 missing.txt"，执行器**自己
      // file_write 造出该文件**再读回凑出期望内容 ⇒ 审查首轮正确拦下，第三轮却被判 98 分。
      '- 禁止为满足验收标准而**伪造前提**：若验收要求某文件/内容"原本存在"或"禁止创建/修改"，**不得**用 `file_write` / `file_edit` 创建或改写它来凑答案；前提不成立时如实报告（写明"文件不存在/无法读取"），不要制造证据。',
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
    // P2-1（2026-11-04）：**每步汇总**口径 —— 逐次调用日志降 debug，
    // 步骤收尾时一次性上报本步计数（真机窗口 4 条逐次日志合计 47.1 MB / 148 k 条）。
    const stepStats = {
      modelCalls: 0,
      modelTotalMs: 0,
      modelMaxMs: 0,
      /**
       * 2026-11-08（真机 `pdca_mw7rsd9j`）：本步**真实** token 消耗（各轮 input+output 累计）。
       * 0 = 执行器未回传 usage（如自定义执行器）⇒ 任务级统计回退 TAORLoop 的预算占用。
       */
      usageTokens: 0,
      toolRounds: 0,
      toolTotalMs: 0,
      slowestToolMs: 0,
      slowestToolName: '',
    };
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
          const rawResult = await executor({
            systemPrompt: EXECUTOR_ROLE.systemPrompt,
            userPrompt: execPrompt + '\n\n' + conversationContext,
            tools: roleToolNames(EXECUTOR_ROLE),
            taskType: EXECUTOR_ROLE.taskType,
            isolation,
          });
          const result = normalizeExecutorResult(rawResult);
          // 2026-11-08（真机 `pdca_mw7rsd9j`）：把执行器回传的 `usage` 转成 TAORLoop 认的
          // chunk（它只从 `chunk.usage.prompt_tokens` 取真实输入量）—— 此前该值被
          // `normalizeExecutorResult` 丢掉 ⇒ `TAORLoop 步骤收尾.totalTokens` 恒 0。
          // 兼容 `prompt_tokens`（provider 原形）与 `inputTokens`（内部形），口径同
          // `recordDailyBudgetFromUsage`。
          const rawUsage =
            typeof rawResult === 'object'
              ? (rawResult.usage as Record<string, number> | undefined)
              : undefined;
          // `Number()` 归一：provider 偶有把用量写成字符串的形态，直接相加会拼串。
          const promptTokens =
            Number(rawUsage?.prompt_tokens ?? rawUsage?.inputTokens ?? 0) || 0;
          const completionTokens =
            Number(
              rawUsage?.completion_tokens ?? rawUsage?.outputTokens ?? 0
            ) || 0;
          stepStats.usageTokens += promptTokens + completionTokens;
          const callElapsed = Date.now() - callStart;
          stepStats.modelCalls += 1;
          stepStats.modelTotalMs += callElapsed;
          stepStats.modelMaxMs = Math.max(stepStats.modelMaxMs, callElapsed);
          // P2-1（2026-11-04）：逐次调用降 debug —— 每步汇总见「TAORLoop 步骤收尾」。
          logger.debug('[orchestrator] callModel 完成', {
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
          // 真实输入量以**独立块**回传：TAORLoop 只读 `chunk.usage`，与块类型/文本无关。
          // 必须放在 `done` 之前（`done` 是末块，会参与 `...lastChunk` 合并）。
          if (promptTokens > 0) {
            yield { type: 'usage', usage: { prompt_tokens: promptTokens } };
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
          stepStats.toolRounds += 1;
          // P2-1（2026-11-04）：逐轮降 debug —— 每步汇总见「TAORLoop 步骤收尾」。
          logger.debug('[orchestrator] executeTools 开始执行', {
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
                // 2026-11-08（真机 `pdca_mw6u5jhp`）：短路结果同样要**触发改道 steering** ——
                // 否则模型会原样重试同一条命令（真机一次步骤里撞了 2 次），既浪费轮次，
                // 又让审查门看到"重复失败"而压分。
                blockedBySecurity.push(tc.name);
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
                    `本任务工作区根目录：${deps.isolation.workspace}。` +
                    '请改用**相对该目录**的路径（如 output/report.md）后重试，不要传仓库根或其它绝对路径。',
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
                // 2026-10-31：与主聊天链（`ToolRegistry` / `ToolManager`）共用同一缺参文案。
                // 此前本链自行拼文案 ⇒ ① `receivedKeys` 把**保留键** `__liri_args_parse_error__`
                // 当成"模型传的参数名"回显；② 真机 2026-10-31 07:19:33Z 实测 `file_edit`
                // 参数 JSON 被截断（`receivedKeys:["__liri_args_parse_error__"]`），模型只收到
                // 通用「若参数为空，多为参数 JSON 非法」⇒ 原样重试同一调用直至验收失败。
                const detail = describeMissingRequiredParams(
                  tc.arguments,
                  missingParams,
                  tool.params.map((p) => p.name)
                );
                logger.warn('[orchestrator] 工具缺少必填参数，已拒绝执行', {
                  taskId: deps.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  toolCallId: tc.id,
                  missingParams,
                  receivedKeys: detail.receivedKeys,
                  ...(detail.parseErr
                    ? {
                        argsParseFailed: true,
                        argsRawLength: detail.parseErr.rawLength,
                      }
                    : {}),
                });
                results.push({
                  toolCallId: tc.id,
                  toolName: tc.name,
                  error: detail.error,
                });
                continue;
              }
              // 2026-11-09（真机：会话「全自动」下长程任务仍弹命令审批）：本链此前**完全绕过
              // 权限层**（仅做越界/缺参校验后直接 `tool.execute()`）⇒ 会话 `permission_mode`
              // 在长程任务里从未生效。现与聊天链同源（`authorizeToolCall`）判定：
              // - deny ⇒ 不执行，把拒绝原因交回模型（可换合法做法）；
              // - ask  ⇒ **不阻断**（长程任务无人值守，任务启动即视为用户授权；审批卡由权限层
              //   提交，批准后下次调用自然命中放行缓存）—— 但**不算自动放行**，安全闸 ask 照旧；
              // - allow ⇒ 执行，并把「权限层已自动放行」写进 `policyContext`，
              //   供 bash 安全闸跳过 **ask 级**拦截（危险命令/路径/沙箱等硬拦截照旧）。
              const auth = await authorizeLroToolCall({
                taskId: deps.taskId,
                sessionId: deps.getSessionId(),
                workspacePath: deps.isolation.workspace,
                toolName: tc.name,
                args: tc.arguments,
              });
              if (auth?.kind === 'deny') {
                logger.warn('[orchestrator] 工具权限拒绝，已阻止执行', {
                  taskId: deps.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  toolCallId: tc.id,
                  reason: auth.reason,
                });
                results.push({
                  toolCallId: tc.id,
                  toolName: tc.name,
                  error: `权限拒绝：${auth.reason ?? '该工具调用不在当前权限允许范围内'}`,
                });
                continue;
              }
              if (auth?.kind === 'ask') {
                logger.info(
                  '[orchestrator] 工具调用需人工确认（不阻断任务，按未自动放行执行）',
                  {
                    taskId: deps.taskId,
                    stepId: step.id,
                    toolName: tc.name,
                    toolCallId: tc.id,
                    reason: auth.reason,
                    permissionMode: auth.permissionMode,
                  }
                );
              }
              // 显式写 false 防「上一次调用自动放行」串用；仅 allow+autoApproved 才置 true
              const policyNow = toolContext.policyContext ?? {};
              const callContext: ToolUseContext =
                auth?.kind === 'allow' && auth.autoApproved
                  ? {
                      ...toolContext,
                      policyContext: {
                        ...policyNow,
                        autoApproved: true,
                        ...(auth.permissionMode
                          ? { permissionMode: auth.permissionMode }
                          : {}),
                      },
                    }
                  : {
                      ...toolContext,
                      policyContext: { ...policyNow, autoApproved: false },
                    };
              // 保留键可能随合法参数一起出现（解析失败时携带诊断）⇒ 执行前剥除，不污染工具入参
              const toolResult = await tool.execute(
                stripArgParseErrorKey(tc.arguments),
                callContext
              );
              // 2026-10-08（steering）：被安全策略拦截的工具名先记账，本轮结束后统一注入改道指令。
              // 2026-11-08（真机 `pdca_mw6yabdj`）：**等人工审批 ≠ 硬拦截** —— ask 结果也带
              // `securityIntercepted`，若同样注入"立即改道"，用户批准的那条命令会被模型主动
              // 改写成等价写法（`-e` → `--eval`）⇒ 命中新指纹再弹一张卡（3 轮不收敛）。
              if (
                isSecurityIntercepted(toolResult) &&
                !isPendingApproval(toolResult)
              ) {
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
              stepStats.toolTotalMs += elapsed;
              if (elapsed > stepStats.slowestToolMs) {
                stepStats.slowestToolMs = elapsed;
                stepStats.slowestToolName = tc.name;
              }
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
                // P2-1（2026-11-04）：逐工具成功降 debug —— 每步汇总见「TAORLoop 步骤收尾」。
                logger.debug('[orchestrator] 工具执行成功', {
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
              stepStats.toolTotalMs += elapsed;
              if (elapsed > stepStats.slowestToolMs) {
                stepStats.slowestToolMs = elapsed;
                stepStats.slowestToolName = tc.name;
              }
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
          // P2-1（2026-11-04）：逐轮汇总降 debug —— 每步汇总见「TAORLoop 步骤收尾」。
          logger.debug('[orchestrator] executeTools 执行完毕', {
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
      // 2026-11-08（真机 `pdca_mw7rsd9j`）：优先用**真实用量累计**（`stepStats.usageTokens`）；
      // 无 usage（自定义执行器）⇒ 回退 TAORLoop 的预算占用量（`result.totalTokens`）。
      const stepTokens =
        stepStats.usageTokens > 0 ? stepStats.usageTokens : result.totalTokens;
      deps.addTotalTokens(stepTokens);
      const stepTok = deps.stepDurations.get(step.id);
      if (stepTok) {
        stepTok.tokens = (stepTok.tokens ?? 0) + stepTokens;
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
            tokens: stepTokens,
            elapsedMs: taorElapsed,
          },
          criticalEvidence
        ) +
        // 2026-11-08（真机 `pdca_mw70c49j`）：把本次调用的**入参（命令原文）**并入证据 ——
        // 只给结果时审查员无法核验"命令原样执行"，会为此反复 retry。
        buildToolCallEvidence(executedToolResults) +
        readBackEvidence;
      const terminationReason = result.terminationReason;
      if (terminationReason === 'awaiting_approval') {
        // 2026-11-06（审批根因簇 P0-2）：TAOR 遇"工具已提交审批"即收尾 ⇒ 本步是**暂停**，
        // 不是"预算内未收敛"，更不是完成。批准后由 resumeStream 续跑；
        // 此处如实落 failed（不计完成），避免 review/目标门把暂停当成就绪。
        taskOrchestrator.markStepFailed(
          step.id,
          `[AWAITING_APPROVAL] 步骤因工具审批暂停，批准后会自动续跑（turns=${result.turnCount}）`,
          {
            partialOutput: stepEvidence,
            terminationReason,
            toolOutcomes,
          }
        );
      } else if (isNonConvergedTermination(terminationReason)) {
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
        // 2026-11-08（真机 `pdca_mw6sfu1y`）：重试**不得覆盖**前一次尝试的成功证据 ——
        // 否则"上一次写出了产物、这一次空手"会让进度门看到零证据（completed 却报 67%）。
        const mergedOutcomes = mergeToolOutcomeSummaries(
          step.toolOutcomes,
          toolOutcomes
        );
        const mergedArtifacts = [
          ...new Set([...(step.artifacts ?? []), ...writtenPaths]),
        ];
        taskOrchestrator.markStepCompleted(step.id, stepEvidence, {
          // E1①（2026-09-05，方案甲）：终止原因透传落 PlanStep
          terminationReason,
          toolOutcomes: mergedOutcomes,
          // LRO-12（2026-10-26）：产物台账（**空数组也传**）⇒ 进度只由产物存在性推进；
          // 本步跑了但没写出任何文件时不推进进度，避免"步骤打勾即完成"的假进度
          artifacts: mergedArtifacts,
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
        totalTokens: stepTokens,
        taorElapsedMs: taorElapsed,
        stepElapsedMs: stepElapsed,
        persistedMsgCount: persistedMessages.length,
        // P2-1（2026-11-04）：**每步汇总**（替代逐次 callModel / executeTools / 工具成功日志）
        modelCalls: stepStats.modelCalls,
        modelTotalMs: stepStats.modelTotalMs,
        modelMaxMs: stepStats.modelMaxMs,
        toolRounds: stepStats.toolRounds,
        toolTotalMs: stepStats.toolTotalMs,
        slowestTool: stepStats.slowestToolName
          ? `${stepStats.slowestToolName}:${stepStats.slowestToolMs}ms`
          : undefined,
        tools: {
          total: toolOutcomes.total,
          success: toolOutcomes.successCount,
          failed: toolOutcomes.failedCount,
          intercepted: toolOutcomes.securityIntercepted,
          pendingApproval: toolOutcomes.pendingApproval,
        },
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
        // #28（2026-10-30）：回写内容必须是**可读文本**。
        // 真机 144 条 assistant 消息正文是 `{"data":...,"success":false,...}` ——
        // 原实现对非字符串 content 直接 `JSON.stringify(...)`，把工具结果整包塞进正文，
        // 用户在气泡里看到原始 JSON。现：只回写叙述类消息（tool 消息已有真实工具块），
        // 对象内容只取可读字段（error/output/content/data/message），取不到就丢弃。
        const readable = persistedMessages
          .filter((m) => m.role !== 'tool')
          .map((m) => ({
            role: (m.role === 'user'
              ? 'user'
              : 'assistant') as TaskMessage['role'],
            content: toReadableTaskContent(m.content).slice(0, 500),
          }))
          .filter((m) => m.content.trim().length > 0)
          .slice(-10);
        if (readable.length > 0) {
          deps.emitTaskMessage(readable);
        }
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
    const { inboxManager } =
      await import('@openliri/service/runtime/InboxManager');
    const {
      hashCommandForExecution,
      hashApprovalFingerprint,
      resolveApprovalFingerprint,
      previewApprovalFingerprint,
      findPendingApprovalId,
    } = await import('@openliri/infra/permission');

    /** 本次已建卡的工具名（同一步骤同一工具只建一张，见下方注释） */
    const alreadyCarded = new Set<string>();

    for (const outcome of pending) {
      // 2026-11-07 真机：步骤被 ask 拦下后模型会换着命令重试，旧实现给**每个不同命令**
      // 各建一张卡（真机一步 11 张）⇒ 同一工具本次只建第一张；步骤恢复后若仍用别的
      // 命令，会在下一轮重新建卡（不会永久丢失审批通道）。
      const toolName = outcome.toolName ?? '';
      if (alreadyCarded.has(toolName)) continue;
      alreadyCarded.add(toolName);
      const call = args.executed.find(
        (r) =>
          r.toolName === outcome.toolName &&
          (!outcome.toolCallId || r.toolCallId === outcome.toolCallId)
      );
      const input = call?.arguments ?? {};
      const fingerprint = resolveApprovalFingerprint(outcome.toolName, input);
      const command = typeof input.command === 'string' ? input.command : '';
      // 风险等级与选项集走 `@openliri/infra/permission` 的唯一实现（P0 三档 + EXTERNAL 收窄），
      // 避免 LRO 步骤卡与聊天侧审批卡再次漂移（真机 `pdca_mw7l43fu`：此前只有 approve_session）。
      const risk = resolveRiskClass(outcome.toolName, input);
      const options = buildApprovalOptions({
        toolName: outcome.toolName,
        command,
        risk,
      });
      // 2026-11-08（真机 `pdca_mw6mbd7w`）：**命令类工具的放行键是命令文本本身**
      // （`BashTool`/`PowerShellTool` 都按 `hashCommandForExecution(command)` 查缓存）。
      // 此前一律对 `fingerprint`（`bash:{"command":…}`）取 hash ⇒ 与执行端永不相等，
      // 用户批准后同一条命令仍被 ask（"批了不生效"）。
      const commandHash =
        isCommandToolName(outcome.toolName) && command.trim()
          ? hashCommandForExecution(command)
          : hashCommandForExecution(fingerprint);
      // 2026-11-08（真机 `pdca_mw6mktrf`）：**必须随卡带上工具自己给出的执行作用域**。
      // 执行端（`BashTool.resolveApprovalState`）查缓存时会传 `approvalScope`；放行记录若
      // 没有 `scopeDigest`（`scopeBound:false`），`isApproved` 按 fail-closed 判**不命中**
      // ⇒ 用户批准后同一条命令照样被 ask。作用域/快照由工具在 ask 结果里给出，此处照抄。
      const resultMeta = (
        call?.result as { metadata?: Record<string, unknown> } | undefined
      )?.metadata;
      const approvalScope = resultMeta?.approvalScope;
      const approvalSnapshot = resultMeta?.approvalSnapshot;

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
        options,
        offlineCapable: true,
        source: 'permission',
        metadata: {
          toolName: outcome.toolName,
          // 与聊天侧审批卡同口径（UI/审计可据此展示风险等级）
          risk,
          taskId: args.taskId,
          stepId: args.stepId,
          commandHash,
          approvalFingerprintHash: hashApprovalFingerprint(fingerprint),
          approvalFingerprintPreview: previewApprovalFingerprint(fingerprint),
          approvalScopeKind: 'once',
          command: command || undefined,
          inputPreview: JSON.stringify(input).slice(0, 200),
          // 2026-11-08：作用域/快照随卡落库 —— 缺了会让批准记录 `scopeBound:false`，
          // 执行端按 fail-closed 判不命中（"批了不生效"）。
          ...(approvalScope ? { approvalScope } : {}),
          ...(approvalSnapshot ? { approvalSnapshot } : {}),
          // B0-3（2026-10-30）：补来源模块，避免 Inbox 记 `missing source reference`
          // 并把 LRO 步骤审批卡标记为孤儿（无法回连到步骤）。
          sourceModule: 'lro-step',
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
