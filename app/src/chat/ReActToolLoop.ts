/**
 * ReActToolLoop — ToolLoopRunner 的 ReActLoop 骨架适配器（M1 细化版）
 *
 * P1-3 迁移：把 ToolLoopRunner 的 while(currentToolCalls.length > 0) 手写循环
 * 收敛到 ReActLoop 统一骨架。
 *
 * M1 细化 6 项（对照双跑一致性报告 §3.2）：
 *  1. 残缺工具调用重试（reason 流式路径：尾部残缺标签检测 + 重试一次）
 *  2. 交互恢复（act：requiresUserInteraction 工具 → pendingInteractions 等待答案）
 *  3. 周期性检查点（beforeReasoning：每 5 轮 saveCheckpointWithData）
 *  4. 循环检测（act：loopDetector.detect critical → 中止循环）
 *  5. 心跳进度数据（子类维护 completedToolNames/totalCompletedToolCount，供转换层聚合）
 *  6. maxTurns 提示文案（finalize：达 maxIterations 时附加提示）
 *
 * M1 致命缺口补齐（B0(M0) 对齐评审，2026-08-13）——对齐旧 ToolLoopRunner 状态机：
 *  A. 首轮 currentToolCalls 直接执行（流式主路径 LLM 已产出 tool_calls，禁止重复调 LLM）
 *  B. 工具结果消息落盘（createToolResultMessage + addAndPersistMessage）
 *  C. 下一轮消息回填（buildToolRoundMessages）+ 轮次推进（nextRound）+ unifiedTracker
 *  D. LLM 结果：stripBareExploration 清洗 + tool_calls metadata + 助手消息落盘 + recordTurn
 *  E. 流式 LLM：完整清洗链（think 标签/图片修复/scrubber/orphan 标签）+ onStream + usage 上报
 *  F. 非流式 LLM：tools 参数透传（toolDefinitions）
 *  G. 流式检查点（streamingCheckpoint.onToolCompleted）+ completedToolCallIds 维护
 */

import { ReActLoop } from '../query/ReActLoop.js';
import type {
  ReActLoopConfig,
  ReasonResult,
  ActResult,
  ToolCallEntry,
  ToolResultEntry,
  ReActEvent,
} from '../query/ReActLoop.js';
import type { ToolLoopContext, ToolLoopInput } from './ToolLoopRunner.js';
import type { ToolCall, ToolResult } from './types/tool.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';
import type { Message } from './types/message.js';
import { getToolCallName } from './types/tool.js';
import { getLogger } from '@modules/monitoring';
import {
  ensureThinkResponseTags,
  stripThinkResponseTags,
  stripOrphanToolTags,
  truncateApiMessages,
} from './services/MessageContextPipeline';
import { StreamingToolCallScrubber } from '../streaming/scrubbers/StreamingToolCallScrubber';
import { stripBareExploration } from './services/bareExplorationStripper';
import { repairImageUrls, extractTodoData } from './services/ChatHelper';
import type { TodoBlockData } from '@modules/runtime/api/todo-types';
import type {
  QuestionData,
  QuestionOption,
} from '@modules/runtime/api/CoreAPI.js';
import { trackUsage } from '@modules/ai';
import {
  shouldAsk as decisionGateCheck,
  type GateTier,
} from './services/DecisionGate';
import {
  loadNegotiationState,
  createNegotiationState,
  addPendingQuestion,
  recordAnswer,
  type NegotiationState,
} from './services/NegotiationState';
// 工具轮内上下文压缩（2026-08-23）：复用主流程压缩策略/编排器，
// 防止长工具会话消息膨胀导致 LLM 请求超限（deepseek 1M 窗口请求 1.78M 实测）
import { autoCompactionPolicy } from '../context/compaction/AutoCompactionPolicy';
import { compactionOrchestrator } from '../context/compaction/CompactionOrchestrator';

const logger = getLogger('chat:reactToolLoop');

/** 残缺工具调用检测：LLM 输出尾部残留未闭合的标签 */
const TRUNCATED_TAG_RE =
  /<\/?(?:parameter|invoke|tool_call|tool_calls)\b[^>]*>\s*$/i;

/** 延时工具（v3：交互心跳轮询用；文件此前无定义，直接使用会编译报错） */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 安全序列化（遗漏 3，2026-08-14 复查）：
 * ToolResult.result 类型为 unknown，工具可返回任意结构；循环引用/BigInt 会抛
 * TypeError → ReActLoop.run() 外层 catch 中断整轮剩余工具执行。失败降级为空串。
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch (err) {
    // 序列化失败（循环引用/BigInt 等异常结构）：降级空串，记录来源便于排查
    logger.warn('reactToolLoop:safeStringify failed', {
      error: String(err),
      valueType: typeof value,
    });
    return '';
  }
}

/** M1 子类自持的跨轮状态 */
interface ReActToolLoopState {
  messages: Record<string, unknown>[];
  assistantMessage: Message | null;
  toolTurnCount: number;
  llmCallCount: number;
  completedToolNames: string[];
  totalCompletedToolCount: number;
  completedToolCallIds: string[];
  loopDetected: { detector: string; message: string } | null;
  /** 工具结果携带的 todo 数据（供转换层产出 todo chunk，对齐旧类 extractTodoData） */
  pendingTodos: TodoBlockData[];
}

export class ReActToolLoop extends ReActLoop<
  ToolLoopInput,
  ToolLoopContext,
  Message
> {
  private ctx: ToolLoopContext;
  private input: ToolLoopInput;

  private loopState: ReActToolLoopState;

  /** P1-3（2026-08-23）：当前工具轮 assistant 消息 id——工具轮入口（首次 _streamLlm 前）预分配，
   *  chunk 事件写入与 createAssistantMessage 复用（N4/A3） */
  private _activeToolRoundMessageId = '';

  /** v3：交互心跳间隔（前端 STREAM_IDLE_TIMEOUT_MS=60s，10s 留 5 次余量）+ 最大等待（防资源泄漏） */
  private static readonly INTERACTION_HEARTBEAT_MS = 10_000;
  private static readonly INTERACTION_MAX_WAIT_MS = 10 * 60_000;
  /** 实例级可配置（测试缩短心跳间隔用），默认取 static 常量 */
  private heartbeatMs: number;
  private maxWaitMs: number;
  /** DecisionGate 门控强度（undefined 表示门控未启用，对齐设计方案 §5.1） */
  private gateTier?: GateTier;
  /** 协商状态（跨消息持久化，null 表示未启用协商引擎） */
  private negotiationState: NegotiationState | null = null;

  constructor(
    ctx: ToolLoopContext,
    input: ToolLoopInput,
    config?: Partial<ReActLoopConfig> & {
      interactionHeartbeatMs?: number;
      interactionMaxWaitMs?: number;
      gateTier?: GateTier;
    }
  ) {
    super({
      maxIterations: ctx.maxToolTurns,
      abortSignal: ctx.abortSignal,
      ...config,
    });
    this.ctx = ctx;
    this.input = input;
    this.heartbeatMs =
      config?.interactionHeartbeatMs ?? ReActToolLoop.INTERACTION_HEARTBEAT_MS;
    this.maxWaitMs =
      config?.interactionMaxWaitMs ?? ReActToolLoop.INTERACTION_MAX_WAIT_MS;
    this.gateTier = config?.gateTier;
    // 加载或创建协商状态（跨消息持久化恢复）
    this.negotiationState = loadNegotiationState(ctx.session.id);
    if (!this.negotiationState) {
      this.negotiationState = createNegotiationState(ctx.session.id, {
        tier: this.gateTier,
      });
    }
    this.loopState = {
      messages: [...input.apiMessages],
      assistantMessage: input.assistantMessage ?? null,
      toolTurnCount: 0,
      llmCallCount: 0,
      completedToolNames: [],
      totalCompletedToolCount: 0,
      completedToolCallIds: [],
      loopDetected: null,
      pendingTodos: [],
    };
  }

  // ─── 骨架 hooks：检查点 + 循环检测（reason 前） ────────

  protected override async beforeReasoning(): Promise<void> {
    // 3. 周期性检查点：每 5 轮保存（失败不阻塞，对齐旧类 _savePeriodicCheckpoint）
    if (
      this.loopState.toolTurnCount > 0 &&
      this.loopState.toolTurnCount % 5 === 0
    ) {
      try {
        const { session } = this.ctx;
        await this.ctx.checkpointService.saveCheckpointWithData(
          session.id,
          session.messages,
          session.metadata,
          session.state,
          `auto-round-${this.loopState.toolTurnCount}`,
          `工具执行第 ${this.loopState.toolTurnCount} 轮自动检查点`,
          true,
          this.ctx.estimateMessagesTokens(
            session.messages as unknown as Record<string, unknown>[]
          )
        );
      } catch {
        // 检查点保存失败不影响执行（@ignore-catch）
      }
    }

    // 4. 工具轮内上下文保护（2026-08-23 修复）：
    //    消息随工具轮累积膨胀（LLM 回复 + 工具结果逐轮回填），而主流程压缩只在
    //    streamMessageFlow 首轮评估一次，工具轮内不再评估 → 长工具会话请求超限
    //    （实测 deepseek-v4-flash 1M 窗口请求 1.78M，OpenAI stream error 400）。
    //    每轮 reason 前对齐主流程：① 评估 → 超限压缩 loopState.messages（本轮 LLM 输入）
    //    ② 发送前兜底截断（压缩不足/未触发时丢弃旧消息，确保输入 ≤ 窗口 - 输出预留）。
    try {
      const { session } = this.ctx;
      const model = (this.ctx.options?.model as string | undefined) ?? '';
      if (this.loopState.messages.length > 0) {
        const evalResult = await autoCompactionPolicy.evaluateAsync(
          this.loopState.messages as unknown as ChatMessage[],
          model
        );
        if (evalResult.decision !== 'skip') {
          logger.info('reactToolLoop:工具轮内压缩评估触发', {
            sessionId: session.id,
            decision: evalResult.decision,
            tokens: evalResult.snapshot.tokens,
            maxTokens: evalResult.snapshot.maxTokens,
            ratio: Number(evalResult.snapshot.ratio.toFixed(3)),
            messageCount: this.loopState.messages.length,
            toolTurn: this.loopState.toolTurnCount,
          });
          const compactResult = await compactionOrchestrator.compact(
            this.loopState.messages as unknown as ChatMessage[],
            { model, sessionId: session.id },
            { skipTier3Sync: true, preEvaluated: evalResult }
          );
          if (compactResult.applied) {
            this.loopState.messages =
              compactResult.messages as unknown as Record<string, unknown>[];
            logger.info('reactToolLoop:工具轮内上下文压缩完成', {
              sessionId: session.id,
              beforeTokens: evalResult.snapshot.tokens,
              afterMessageCount: compactResult.messages.length,
              toolTurn: this.loopState.toolTurnCount,
            });
          }
        }
        // 兜底：无论压缩是否生效，发送前强制截断（估算超窗口-输出预留才截断，否则零开销早退）
        await truncateApiMessages(
          this.loopState.messages as unknown as Record<string, unknown>[],
          evalResult.snapshot.maxTokens,
          new Map([[session.id, session]]),
          session.id,
          (this.ctx.options?.maxTokens as number | undefined) ?? undefined
        );
      }
    } catch {
      // 压缩/截断失败不阻断工具循环（@ignore-catch，CS03）
    }
  }

  // ─── 抽象方法 ──────────────────────────────────────

  protected async *reason(
    _input: ToolLoopInput,
    context?: ToolLoopContext
  ): AsyncGenerator<ReActEvent, ReasonResult<ToolLoopContext>> {
    // 4. 循环检测已触发 → 不再调 LLM，直接结束
    if (this.loopState.loopDetected) {
      return { text: '', toolCalls: [], finishReason: 'stop', context };
    }

    // A. 首轮已有待执行工具（流式主路径：主回复 LLM 已产出 tool_calls）→ 直接执行，不再调 LLM。
    //    对齐旧类 run()：currentToolCalls.length > 0 时跳过初始 LLM 调用直接进工具循环。
    if (
      this.loopState.toolTurnCount === 0 &&
      !this.input.needsInitialLlmCall &&
      this.input.currentToolCalls.length > 0
    ) {
      const toolCalls: ToolCallEntry[] = this.input.currentToolCalls.map(
        (tc) => ({
          id: tc.id,
          name:
            getToolCallName(tc as { name?: string; function?: string }) ||
            tc.name,
          input: tc.arguments ?? {},
        })
      );
      return {
        // 主回复流已显示该文本，A-path 不再重复输出（转换层 reasoning_end 会跳过空文本）
        text: '',
        toolCalls,
        finishReason: 'tool_calls',
        context,
      };
    }

    // LLM 调用（M4 方案 A）：流式路径逐 chunk 增量 yield（reasoning_delta/thinking_delta，P0-C 恢复）；
    // 非流式路径整段返回。
    let response: ChatResponse;
    let cleanContent = '';
    if (this.input.nonStreaming) {
      response = await this._callLlmNonStreaming();
      cleanContent = response.content ?? '';
    } else {
      response = yield* this._consumeStreamingLlm(false);
      cleanContent = response.content ?? '';
    }

    // 1. 残缺工具调用重试：流式输出尾部残留未闭合标签且无 tool_calls → 重试一次
    if (
      !response.tool_calls?.length &&
      TRUNCATED_TAG_RE.test(cleanContent.trimEnd())
    ) {
      logger.warn('reactToolLoop:truncated_tool_call_retry', {
        sessionId: this.ctx.session.id,
        contentTail: cleanContent.slice(-160),
      });
      // 5. 残缺重试时 maxTokens 加倍（对齐旧类 _streamLlmRound L868-870），提高完整输出概率
      if (this.input.nonStreaming) {
        response = await this._callLlmNonStreaming();
      } else {
        response = yield* this._consumeStreamingLlm(true);
      }
      cleanContent = response.content ?? '';
    }

    const toolCalls: ToolCallEntry[] = (response.tool_calls ?? []).map(
      (tc) => ({
        id: tc.id,
        name:
          getToolCallName(tc as { name?: string; function?: string }) ||
          tc.name,
        input: tc.arguments ?? {},
      })
    );

    // 排查锚点：每轮推理产出的工具调用默认可见。circuit_breaker 触发时，
    // 配合 onToolCall end 和工具自身失败日志，可完整还原"AI 决策 → 工具执行 → 失败"链路。
    // 参数 JSON 化后截断 200 字符（命令类工具如 powershell/bash 必须能看到命令内容）。
    if (toolCalls.length > 0) {
      logger.info('reactToolLoop:reason_tool_calls', {
        sessionId: this.ctx.session.id,
        iteration: this.state.iteration,
        toolCallCount: toolCalls.length,
        toolCalls: toolCalls.map((tc) => ({
          name: tc.name,
          argsPreview: safeStringify(tc.input).slice(0, 200),
        })),
        finishReason:
          (response as { finishReason?: string }).finishReason ??
          (response as { stop_reason?: string }).stop_reason ??
          'unknown',
      });
    }

    // D. 对齐旧类 _prepareNextRound：清洗叙述 + tool_calls metadata + 助手消息落盘
    const repairedContent = stripBareExploration(cleanContent);
    const resp = response as unknown as {
      finishReason?: string;
      stop_reason?: string;
    };

    // P0-fix: 如果 assistantMessage 已存在（流式主路径已创建），更新它而不是创建新消息
    // 这解决了重复消息问题：streamMessageFlow.ts 创建第一条后，ReActToolLoop 不应再创建第二条
    // 注意：不调用 addAndPersistMessage，因为 _finalizeStreamMessage 会在最后统一持久化
    if (this.loopState.assistantMessage) {
      const existingMsg = this.loopState.assistantMessage;
      existingMsg.content = repairedContent;
      existingMsg.finishReason =
        resp.finishReason || resp.stop_reason || 'stop';
      if (response.tool_calls?.length) {
        existingMsg.metadata = {
          ...existingMsg.metadata,
          tool_calls: response.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        };
      }
      logger.debug('reactToolLoop:reason updated existing assistantMessage', {
        sessionId: this.ctx.session.id,
        messageId: existingMsg.id,
        contentLength: repairedContent.length,
      });
    } else {
      const assistantMsg = this.ctx.messageService.createAssistantMessage(
        repairedContent,
        {
          sessionId: this.ctx.session.id,
          // P1-3：复用工具轮入口预分配的 id（A3），保证 chunk 事件与落盘 id 一致
          id: this._activeToolRoundMessageId,
        }
      );
      assistantMsg.finishReason =
        resp.finishReason || resp.stop_reason || 'stop';
      if (response.tool_calls?.length) {
        assistantMsg.metadata = {
          ...assistantMsg.metadata,
          tool_calls: response.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        };
      }
      this.ctx.addAndPersistMessage(this.ctx.session.id, assistantMsg);
      this.loopState.assistantMessage = assistantMsg;
    }

    // 4. LoopDetector 记录轮次（对齐旧类 recordTurn(currentToolCalls.length > 0)）
    this.ctx.loopDetector.recordTurn(toolCalls.length > 0);

    return {
      text: cleanContent,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      context,
    };
  }

  protected async *act(
    calls: ToolCallEntry[],
    _context?: ToolLoopContext
  ): AsyncGenerator<ReActEvent, ActResult> {
    this.loopState.toolTurnCount++;
    const results: ToolResultEntry[] = [];
    const processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }> = [];

    try {
      // 4. 循环检测：对本轮工具调用预检（critical 中止，warning 记录）
      for (const tc of calls) {
        const detection = this.ctx.loopDetector.detect(tc.name, tc.input);
        if (detection.stuck && detection.level === 'critical') {
          this.loopState.loopDetected = {
            detector: detection.detector ?? 'unknown',
            message: detection.message ?? '未提供详情',
          };
          logger.warn('reactToolLoop:loop_detected', {
            sessionId: this.ctx.session.id,
            toolName: tc.name,
            detector: this.loopState.loopDetected.detector,
            message: this.loopState.loopDetected.message,
            turn: this.loopState.toolTurnCount,
          });
          return { results: [], allSucceeded: false, anyAborted: false };
        }
      }

      for (const tc of calls) {
        // DecisionGate 门控检查（设计方案 §5.3）：执行前检查是否需要用户确认
        if (this.gateTier) {
          const gateQuestion = decisionGateCheck(
            { toolName: tc.name, toolInput: tc.input },
            this.gateTier,
            'execute'
          );
          if (gateQuestion) {
            const gateQuestionData: QuestionData = {
              questionId: gateQuestion.id,
              question: gateQuestion.question,
              header: '决策确认',
              options: gateQuestion.options
                ? gateQuestion.options.map((o: string) => ({
                    label: o,
                    description: gateQuestion.rationale,
                  }))
                : [
                    { label: '继续', description: gateQuestion.rationale },
                    { label: '取消', description: '跳过此操作' },
                  ],
              multiSelect: false,
              questionType: gateQuestion.type,
            };
            if (this.ctx.pendingInteractions.has(this.ctx.session.id)) {
              logger.warn('reactToolLoop:gate_already_pending', {
                sessionId: this.ctx.session.id,
                toolName: tc.name,
              });
              results.push({
                toolCallId: tc.id,
                name: tc.name,
                status: 'error' as const,
                error: '已有待处理交互，决策门控被跳过',
              });
              continue;
            }
            let gateResolve!: (answers: string[]) => void;
            const gatePromise = new Promise<string[]>(
              (res) => (gateResolve = res)
            );
            this.ctx.pendingInteractions.set(this.ctx.session.id, {
              questionId: gateQuestion.id,
              promise: gatePromise,
              resolve: gateResolve,
            });
            logger.info('reactToolLoop:gate_question_emitted', {
              sessionId: this.ctx.session.id,
              toolCallId: tc.id,
              toolName: tc.name,
              questionId: gateQuestion.id,
              signalKind: gateQuestion.signal?.kind,
            });
            if (this.negotiationState) {
              addPendingQuestion(this.negotiationState, gateQuestion);
            }
            yield { type: 'question', questionData: gateQuestionData };
            const gateIter = this._awaitAnswersWithHeartbeat(
              gateQuestion.id,
              gatePromise
            );
            let gateAnswerResult = await gateIter.next();
            while (!gateAnswerResult.done) {
              yield gateAnswerResult.value;
              gateAnswerResult = await gateIter.next();
            }
            const gateAnswers = gateAnswerResult.value;
            if (this.negotiationState && gateAnswers) {
              recordAnswer(this.negotiationState, gateQuestion.id, gateAnswers);
            }
            if (
              !gateAnswers ||
              gateAnswers.length === 0 ||
              gateAnswers[0] === '取消' ||
              gateAnswers[0] === '跳过' ||
              gateAnswers[0] === '中止'
            ) {
              logger.info('reactToolLoop:gate_rejected', {
                sessionId: this.ctx.session.id,
                toolCallId: tc.id,
                toolName: tc.name,
              });
              results.push({
                toolCallId: tc.id,
                name: tc.name,
                status: 'error' as const,
                error: '用户取消执行',
              });
              continue;
            }
          }
        }

        // 2. 交互恢复：requiresUserInteraction 工具等待用户答案（v3：yield question 事件穿透 generator 挂起链路）
        const toolObj = this.ctx.toolRegistry.getTool(tc.name);
        if (toolObj?.requiresUserInteraction?.()) {
          const isRecovery =
            this.input.interactionContext &&
            calls.indexOf(tc) === this.input.interactionContext.interactionIdx;
          if (isRecovery) {
            (tc.input as Record<string, unknown>)._userAnswers =
              this.input.interactionContext!.userAnswers;
          } else {
            // 同轮多提问防护（v3）：Map 单槽不静默覆盖——构造 error result 保证 tool_end 闭环（避免 tool_start 卡片悬挂）
            if (this.ctx.pendingInteractions.has(this.ctx.session.id)) {
              logger.warn('reactToolLoop:interaction_already_pending', {
                sessionId: this.ctx.session.id,
                toolName: tc.name,
                toolCallId: tc.id,
              });
              results.push({
                toolCallId: tc.id,
                name: tc.name,
                status: 'error' as const,
                error: '已有待处理交互，本次提问被拒绝',
              });
              continue;
            }
            const { questionData, promise } = this._registerInteraction(tc);
            // 挂起前产出 question 事件（★ 穿透 generator 挂起链路的唯一通道）
            logger.info('reactToolLoop:interaction_question_emitted', {
              sessionId: this.ctx.session.id,
              toolCallId: tc.id,
              toolName: tc.name,
              questionId: questionData.questionId,
            });
            yield { type: 'question', questionData };
            // 迭代消费心跳 generator（★ 禁止 await async generator：直接 await 不执行代码，心跳全丢）
            const answersIter = this._awaitAnswersWithHeartbeat(
              questionData.questionId,
              promise
            );
            let answersResult = await answersIter.next();
            while (!answersResult.done) {
              yield answersResult.value; // question_waiting 心跳转发
              answersResult = await answersIter.next();
            }
            const answers = answersResult.value; // string[] | undefined
            if (answers) {
              (tc.input as Record<string, unknown>)._userAnswers = answers;
            }
          }
        }

        // P0-4（2026-08-14）：工具执行事件同步触发 onToolCall（对齐 TAOR 路径 ChatManagerTAORAdapter）：
        // start 携带完整参数对象（不再截断）→ CoreAPIImpl.onToolCall 产出带参数的 tool_call chunk + "🔧 Running tool" 提示；
        // end 携带 ok/message/result → 产出 "✅/❌ Tool xxx completed" 提示 + toolResultCache 注入。
        // （参数显示另有事件流 tool_start 兜底，前端按 toolCallId 去重合并，不产生双卡片。）
        // 排查日志：日志内仍截断 200 字符，实际回调传完整对象。
        // 遗漏 3：safeStringify 防循环引用/BigInt 抛错中断整轮工具。
        const rawArgsJson = safeStringify(tc.input);
        logger.debug('reactToolLoop:onToolCall start', {
          sessionId: this.ctx.session.id,
          toolName: tc.name,
          toolCallId: tc.id,
          argsLength: rawArgsJson.length,
          detail: rawArgsJson.slice(0, 200),
          onToolCallRegistered: !!this.ctx.onToolCall,
        });
        this.ctx.onToolCall?.('start', tc.name, tc.id, {
          args: tc.input,
        });

        // 2026-08-24 进度链路打通：收集工具执行中的细粒度进度回调，
        // 工具完成后批量 yield tool_progress 事件（reactEventsToChunks 已实现
        // 500ms 节流 → status chunk "工具执行中 X%"），与心跳 execution_phase 互补。
        const progressEvents: number[] = [];
        const toolResult = await this.ctx.executeTool(
          {
            id: tc.id,
            name: tc.name,
            arguments: tc.input,
            sessionId: this.ctx.session.id,
          },
          {
            useErrorHandler: true,
            onProgress: (p) => {
              const data = (p.data ?? {}) as { percentage?: number };
              if (typeof data.percentage === 'number') {
                progressEvents.push(data.percentage);
              }
            },
          }
        );

        // 工具完成后批量产出 tool_progress 事件（细粒度百分比进度）
        for (const percentage of progressEvents) {
          yield { type: 'tool_progress', callId: tc.id, progress: percentage };
        }

        // 遗漏 2（2026-08-14 复查）：审批等待态判定提前（原 L381 重复计算，现合并）。
        // 审批等待工具不触发 onToolCall('end')——否则 CoreAPIImpl 误发 "✅ Tool completed"、
        // 前端聚合把审批中工具计入 completed++（显示 "2/3 完成"），与 pendingApproval 徽标矛盾。
        const isPendingApproval =
          (toolResult as { result?: { pendingApproval?: boolean } })?.result
            ?.pendingApproval === true;

        const rawResultJson = safeStringify(toolResult.result);
        const resultMessage = toolResult.error
          ? `失败: ${toolResult.error.slice(0, 200)}`
          : `成功: ${rawResultJson.slice(0, 200)}`;
        // 排查锚点：工具执行结果默认可见。失败用 WARN（circuit_breaker 触发时必须能
        // 看到每轮失败原因），成功用 INFO（避免 DEBUG 默认不可见导致排查断链）。
        // 配合 PowerShellTool:execution_failed 等工具自身的失败日志定位根因。
        const toolStatus = toolResult.error ? 'failed' : 'success';
        if (toolResult.error) {
          logger.warn('reactToolLoop:onToolCall end', {
            sessionId: this.ctx.session.id,
            toolName: tc.name,
            toolCallId: tc.id,
            status: toolStatus,
            detail: resultMessage,
            onToolCallRegistered: !!this.ctx.onToolCall,
            pendingApproval: isPendingApproval,
          });
        } else {
          logger.info('reactToolLoop:onToolCall end', {
            sessionId: this.ctx.session.id,
            toolName: tc.name,
            toolCallId: tc.id,
            status: toolStatus,
            detail: resultMessage,
            onToolCallRegistered: !!this.ctx.onToolCall,
            pendingApproval: isPendingApproval,
          });
        }
        if (!isPendingApproval) {
          this.ctx.onToolCall?.('end', tc.name, tc.id, {
            ok: !toolResult.error,
            message: resultMessage,
            result: toolResult.result,
          });
        }

        // 工具结果注册表 + 循环检测记录 + 心跳进度数据（5）
        try {
          this.ctx.toolResultRegistry.storeResult(
            this.ctx.session.id,
            tc.id,
            tc.name,
            tc.input,
            { result: toolResult.result, error: toolResult.error },
            this.ctx.toolResultRegistry.getCurrentRound(this.ctx.session.id)
          );
          this.ctx.loopDetector.recordToolCallOutcome(
            tc.name,
            tc.input,
            toolResult.result,
            toolResult.error
          );
        } catch {
          // 注册/记录失败不影响执行
        }

        // B. 工具结果消息落盘（对齐旧类 _executeToolRound L673-680）
        // P1-4（2026-08-23）：metadata 携带 parentMessageId（= 归属 assistant 消息 id，G1/N6/A2），
        // convertMessage 的 tool 分支据此生成 tool/result.messageId。
        // T2.3（2026-08-23）：metadata 携带 callSeq（= tool_call 事件 seq，A1③ 闭环）——
        // streamMessageFlow 在写 assistant/tool_call 事件时填充 toolCallSeqMap，
        // convertMessage tool 分支据此直读生成 tool/result.callSeq，不再依赖 _toolCallSeqMap 回填。
        const toolResultMsg = this.ctx.messageService.createToolResultMessage(
          toolResult,
          {
            sessionId: this.ctx.session.id,
            metadata: {
              ...(toolResult.metadata as Record<string, unknown> | undefined),
              parentMessageId:
                this.loopState.assistantMessage?.id ??
                this._activeToolRoundMessageId,
              ...(this.ctx.toolCallSeqMap?.has(tc.id)
                ? { callSeq: this.ctx.toolCallSeqMap.get(tc.id) }
                : {}),
            },
          }
        );
        this.ctx.addAndPersistMessage(this.ctx.session.id, toolResultMsg);

        // G. 流式检查点（对齐旧类 L707-724）：断点续跑依赖此数据
        if (!this.loopState.completedToolNames.includes(tc.name)) {
          this.loopState.completedToolNames.push(tc.name);
        }
        this.loopState.totalCompletedToolCount++;
        if (!isPendingApproval) {
          this.loopState.completedToolCallIds.push(tc.id);
        }
        try {
          await this.ctx.streamingCheckpoint.onToolCompleted({
            newMessagesSinceLastCheckpoint: [
              this.loopState.assistantMessage,
              toolResultMsg,
            ],
            messagesSnapshot: this.ctx.session.messages.slice(),
            currentToolCalls: calls
              .filter((c) => c.id !== tc.id)
              .map((c) => ({
                id: c.id,
                name: c.name,
                arguments: c.input,
              })),
            completedToolCallIds: [...this.loopState.completedToolCallIds],
            generatorState: {
              toolTurnCount: this.loopState.toolTurnCount,
              llmCallCount: this.loopState.llmCallCount,
            },
            metadata: { model: this.ctx.options?.model },
            sessionState: this.ctx.session.state,
          });
        } catch {
          // 流式检查点失败不影响执行（@ignore-catch）
        }

        results.push({
          toolCallId: tc.id,
          name: tc.name,
          status: toolResult.error ? 'error' : 'success',
          // 遗漏 1（2026-08-14 复查）：对象/数组结果（grep/glob/create_project 等经
          // ToolExecutor 返回 result.data 为对象）也下发——否则 tool_end 转换层 result
          // undefined → 前端工具卡片结果区空白。对齐 ToolExecutor.ts 的 JSON.stringify 方案。
          output:
            typeof toolResult.result === 'string'
              ? toolResult.result
              : toolResult.result !== undefined
                ? safeStringify(toolResult.result)
                : undefined,
          error: toolResult.error,
        });
        // todo chunk 数据：工具结果含 _todoData 时收集（对齐旧类 _executeToolRound extractTodoData）
        const todoData = extractTodoData(toolResult);
        if (todoData) {
          this.loopState.pendingTodos.push(todoData);
        }
        processedResults.push({
          normalizedToolCall: {
            id: tc.id,
            name: tc.name,
            arguments: tc.input,
          },
          result: toolResult,
        });
      }

      // C. 下一轮消息回填（对齐旧类 L406-411）+ 轮次推进 + unifiedTracker（L413-419）
      if (this.loopState.assistantMessage) {
        this.loopState.messages = this.ctx.buildToolRoundMessages(
          this.loopState.messages,
          this.loopState.assistantMessage,
          calls.map((c) => ({
            id: c.id,
            name: c.name,
            arguments: c.input,
          })),
          processedResults as Array<{
            normalizedToolCall: ToolCall;
            result: ToolResult;
          }>
        );
      }
      this.ctx.toolResultRegistry.nextRound(this.ctx.session.id);
      this.ctx.unifiedTracker.resetStreamTokens();
      const model = this.ctx.options?.model as string | undefined;
      if (model) {
        await this.ctx.unifiedTracker.updateBaselineForRound(
          this.loopState.messages as unknown as Record<string, unknown>[],
          model
        );
      }

      return {
        results,
        allSucceeded: results.every((r) => r.status === 'success'),
        anyAborted: false,
      };
    } finally {
      // B-2（2026-08-23）：工具调用未完成终态补发——已写 tool_call 事件
      // （toolCallSeqMap 有记录）但未完成的工具，补发 tool/canceled，保证事件流
      // 有完整终态（回放/日志不再把"已放弃"误显示为"进行中"；ask_user_question
      // 等交互挂起同样覆盖）。
      try {
        for (const tc of calls) {
          if (this.loopState.completedToolCallIds.includes(tc.id)) continue;
          if (!this.ctx.toolCallSeqMap?.has(tc.id)) continue; // 未发 tool_call 事件
          await this._appendStreamEvent('tool/canceled', {
            toolCallId: tc.id,
            callSeq: this.ctx.toolCallSeqMap.get(tc.id) ?? 0,
            reason: '工具调用未完成（工具循环结束/中止）',
          });
        }
      } catch {
        // @ignore-catch — 补发失败不影响主流程（CS03）
      }
    }
  }

  protected shouldContinue(
    _input: ToolLoopInput,
    result: ReasonResult<ToolLoopContext>
  ): boolean {
    // 4. 循环检测触发后停止
    if (this.loopState.loopDetected) return false;
    return result.toolCalls.length > 0;
  }

  protected finalize(): Message {
    // 6. maxTurns 提示文案：达 maxIterations 时附加
    if (
      this.state.iteration >= this.config.maxIterations &&
      this.state.phase === 'completed'
    ) {
      const base = this.loopState.assistantMessage?.content ?? '';
      const tip = `\n\n⚠️ 已达到最大工具轮次限制 (${this.config.maxIterations})，工具链提前终止。`;
      return this.ctx.messageService.createAssistantMessage(base + tip, {
        sessionId: this.ctx.session.id,
      });
    }
    // 4. 循环检测提示
    if (this.loopState.loopDetected) {
      const tip = `\n\n⚠️ 检测到工具调用循环 [${this.loopState.loopDetected.detector}] ${this.loopState.loopDetected.message}，任务提前终止。`;
      return this.ctx.messageService.createAssistantMessage(
        (this.loopState.assistantMessage?.content ?? '') + tip,
        { sessionId: this.ctx.session.id }
      );
    }
    if (this.loopState.assistantMessage) {
      return this.loopState.assistantMessage;
    }
    return this.ctx.messageService.createAssistantMessage(
      this.state.lastError ?? '',
      { sessionId: this.ctx.session.id }
    );
  }

  // ─── 私有辅助 ───────────────────────────────────────

  /** 非流式 LLM 调用（对齐旧类 _nonStreamingLlmRound）：tools 透传 + usage 上报 */
  private async _callLlmNonStreaming(): Promise<ChatResponse> {
    this.loopState.llmCallCount++;
    const response = await this.ctx.activeClient.sendMessage(
      this.loopState.messages as unknown as ChatMessage[],
      {
        ...this.ctx.options,
        tools:
          this.ctx.toolDefinitions.length > 0
            ? this.ctx.toolDefinitions
            : undefined,
      }
    );
    this._reportUsage(response);
    return response;
  }

  /**
   * 流式 LLM 调用（generator，M4 方案 A）：逐 chunk 增量 yield reasoning_delta / thinking_delta
   * （P0-C 恢复 + thinking 转发），return 携带清洗后的 ChatResponse。
   * @param retried 残缺工具重试标记：maxTokens 加倍（对齐旧类 _streamLlmRound）
   */
  /**
   * M1 事件溯源（2026-08-23）：工具轮 text/thinking chunk 写 events.jsonl。
   * 对齐 streamMessageFlow 主循环（首轮已实时写）——此前缺失导致工具轮正文/思考
   * 不进事件流，重新打开会话（events 派生）时正文缺失，仅靠 legacy 合并兜底。
   */
  private async _appendStreamEvent(
    type: 'assistant/text' | 'assistant/thinking' | 'tool/canceled',
    data: unknown
  ): Promise<void> {
    const { appendStreamEvent, getStreamTailSeq } = this.ctx;
    if (!appendStreamEvent || !getStreamTailSeq) return;
    try {
      const ts = await getStreamTailSeq(this.ctx.session.id);
      await appendStreamEvent(this.ctx.session.id, {
        type,
        schemaVersion: 1,
        seq: ts + 1,
        time: Date.now(),
        sessionId: this.ctx.session.id,
        // P1-3：工具轮 chunk 事件携带预分配的 assistant 消息 id
        data: {
          ...(data as Record<string, unknown>),
          messageId: this._activeToolRoundMessageId,
        },
      });
    } catch {
      // @ignore-catch — 事件追加失败不阻断工具循环（CS03）
    }
  }

  /**
   * G12（2026-08-23）：骨架 run() 产出的 tool_start/tool_end 事件携带工具轮消息 id，
   * 供 reactEventsToChunks 透传到 SSE chunk（前端工具轮块归属对位）。
   */
  protected override getCurrentMessageId(): string | undefined {
    return this._activeToolRoundMessageId || undefined;
  }

  private async *_streamLlm(
    retried = false
  ): AsyncGenerator<ReActEvent, ChatResponse> {
    this.loopState.llmCallCount++;
    // P1-3（2026-08-23）：工具轮 assistant 消息 id 预分配——必须在首个 chunk 事件写入前确定，
    // 首次工具轮 loopState.assistantMessage 尚不存在（N4/A3）；已有则复用其 id。
    this._activeToolRoundMessageId =
      this.loopState.assistantMessage?.id ||
      `msg-turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const toolRoundBaseMaxTokens =
      (this.ctx.options?.maxTokens as number | undefined) ?? 4096;
    const gen = this.ctx.activeClient.streamMessage(
      this.loopState.messages as unknown as ChatMessage[],
      {
        ...this.ctx.options,
        maxTokens: retried
          ? Math.min(Math.max(toolRoundBaseMaxTokens * 2, 8192), 64000)
          : toolRoundBaseMaxTokens,
        signal: this.ctx.abortSignal,
        tools:
          this.ctx.toolDefinitions.length > 0
            ? this.ctx.toolDefinitions
            : undefined,
      }
    );
    const textChunks: string[] = [];
    let next = await gen.next();
    while (!next.done) {
      const chunk = next.value;
      if (typeof chunk === 'string') {
        textChunks.push(chunk);
        // 增量文本即时输出（对齐旧类 P0-C：工具轮 LLM 文本逐 chunk SSE）
        yield {
          type: 'reasoning_delta',
          text: chunk,
          messageId: this._activeToolRoundMessageId,
        };
        // M1 事件溯源：工具轮 text chunk 补写 assistant/text 事件
        await this._appendStreamEvent('assistant/text', { content: chunk });
      } else if (chunk?.type === 'thinking') {
        yield {
          type: 'thinking_delta',
          content: chunk.content,
          messageId: this._activeToolRoundMessageId,
        };
        await this._appendStreamEvent('assistant/thinking', {
          content: chunk.content,
        });
      }
      next = await gen.next();
    }
    const final = next.value as ChatResponse;
    const rawContent = final.content ?? textChunks.join('');

    // 清洗链：think 标签修复 → 图片修复 → strip think → scrubber → orphan 标签
    const repairedContent = ensureThinkResponseTags(
      repairImageUrls(rawContent)
    );
    const strippedContent = stripThinkResponseTags(repairedContent);
    const scrubber = new StreamingToolCallScrubber();
    const scrubbed = scrubber.scrub({
      content: strippedContent,
      isComplete: true,
    });
    const residual = scrubber.flush();
    const cleanContent = stripOrphanToolTags(scrubbed.content + residual);
    const onStream = this.ctx.options?.onStream as
      | ((content: string) => void)
      | undefined;
    onStream?.(cleanContent);

    this._reportUsage(final);

    return {
      ...final,
      content: cleanContent,
    };
  }

  /** 转发流式 LLM 的增量事件，收集 return 值（供 reason generator 使用） */
  private async *_consumeStreamingLlm(
    retried: boolean
  ): AsyncGenerator<ReActEvent, ChatResponse> {
    const iter = this._streamLlm(retried);
    let r = await iter.next();
    while (!r.done) {
      yield r.value;
      r = await iter.next();
    }
    return r.value;
  }

  /** usage 上报（对齐旧类：recordChatResponseUsage + onToolUsage + trackUsage） */
  private _reportUsage(response: ChatResponse): void {
    const usage = (response as unknown as { usage?: ChatResponse['usage'] })
      .usage;
    // 成本 0/0 修复（2026-08-14 复检 #5）：provider 流式返回的 usage 缺失（undefined）
    // 时跳过空记录——原实现无条件 trackUsage，产生 "LLM call recorded: 0/0 tokens"
    // + warn"成本累加" 空条，污染 LLMTracker 与成本统计。真实 usage 由 trace-recording
    // 层独立记录并驱动校准因子，此处空记录不丢真实数据。
    if (
      !usage ||
      (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) === 0
    ) {
      return;
    }
    this.ctx.recordChatResponseUsage(this.ctx.session.id, usage);
    this.ctx.onToolUsage?.((usage as Record<string, unknown>) ?? {});
    trackUsage(response as unknown as Record<string, unknown>, {
      model: (this.ctx.options?.model as string) || 'unknown',
      providerId: this.ctx.activeClient.getProviderId(),
      latencyMs: 0,
      isStreaming: !this.input.nonStreaming,
      sessionId: this.ctx.session.id,
    }).catch(() => {});
  }

  /**
   * 注册 pendingInteraction，返回 questionData + 等待 promise（v3：不挂起调用方，
   * 由 act 内迭代消费 _awaitAnswersWithHeartbeat 产出心跳并等待答案）。
   */
  private _registerInteraction(tc: ToolCallEntry): {
    questionData: QuestionData;
    promise: Promise<string[]>;
  } {
    const questionId = `q_${Date.now()}_${(tc.id || '').slice(0, 8)}`;
    const args = tc.input as Record<string, unknown>;
    const questionData: QuestionData = {
      questionId,
      question: String(args.question),
      header: String(args.header),
      options: (args.options as QuestionOption[]) ?? [],
      multiSelect: args.multiSelect === true,
      questionType:
        (args.questionType as QuestionData['questionType']) ?? 'choice',
    };
    let resolve!: (answers: string[]) => void;
    const promise = new Promise<string[]>((res) => (resolve = res));
    this.ctx.pendingInteractions.set(this.ctx.session.id, {
      questionId,
      promise,
      resolve,
    });
    logger.info('reactToolLoop:interaction_registered', {
      sessionId: this.ctx.session.id,
      questionId,
      question: String(args.question).slice(0, 100),
      optionCount: (args.options as QuestionOption[])?.length ?? 0,
      multiSelect: args.multiSelect === true,
    });
    return { questionData, promise };
  }

  /**
   * 等待答案：Promise.race 轮询产出心跳事件 + abort/超时兜底。
   * ★ async generator，必须迭代消费（act 内 while 转发 yield），禁止直接 await。
   */
  private async *_awaitAnswersWithHeartbeat(
    questionId: string,
    promise: Promise<string[]>
  ): AsyncGenerator<ReActEvent, string[] | undefined> {
    const sig = this.ctx.abortSignal;
    const onAbort = () => abortResolve('abort');
    let abortResolve!: (v: 'abort') => void;
    const abortPromise = new Promise<'abort'>((res) => {
      abortResolve = res;
      // v3：sig undefined 时禁用 abort 兜底（超时兜底仍生效），不再静默挂起
      if (!sig) return;
      if (sig.aborted) {
        res('abort');
        return;
      }
      sig.addEventListener('abort', onAbort, { once: true });
    });
    const timeoutPromise = new Promise<'timeout'>((res) =>
      setTimeout(res, this.maxWaitMs, 'timeout' as const)
    );
    try {
      const waitStart = Date.now();
      logger.info('reactToolLoop:interaction_wait_start', {
        sessionId: this.ctx.session.id,
        questionId,
        heartbeatMs: this.heartbeatMs,
        maxWaitMs: this.maxWaitMs,
      });
      while (true) {
        const winner = await Promise.race([
          promise.then((a) => ({ kind: 'answer' as const, value: a })),
          sleep(this.heartbeatMs).then(() => ({
            kind: 'hb' as const,
          })),
          abortPromise.then((v) => ({ kind: v as 'abort' })),
          timeoutPromise.then((v) => ({ kind: v as 'timeout' })),
        ]);
        if (winner.kind === 'answer') {
          logger.info('reactToolLoop:interaction_resolved', {
            sessionId: this.ctx.session.id,
            questionId,
            answerCount: winner.value.length,
            waitMs: Date.now() - waitStart,
          });
          return winner.value;
        }
        if (winner.kind === 'abort' || winner.kind === 'timeout') {
          logger.warn('reactToolLoop:interaction_stopped', {
            sessionId: this.ctx.session.id,
            questionId,
            reason: winner.kind,
            waitMs: Date.now() - waitStart,
          });
          return undefined;
        }
        // 心跳事件（高频：仅 debug，避免刷屏；配合 wait_start/resolved 可还原完整等待曲线）
        logger.debug('reactToolLoop:interaction_heartbeat', {
          sessionId: this.ctx.session.id,
          questionId,
          waitMs: Date.now() - waitStart,
        });
        yield { type: 'question_waiting' }; // 心跳事件
      }
    } finally {
      // v3：显式移除 abort 监听器，避免跨轮多次提问累积
      if (sig) sig.removeEventListener('abort', onAbort);
      this.ctx.pendingInteractions.delete(this.ctx.session.id);
    }
  }

  /** 供调用点读取最终消息（A2 runCollect 取 return 值即达）。
   *  始终走 finalize()：其内部已按 正常消息 → 循环检测提示 → maxTurns 提示 → lastError 分支处理，
   *  直接返回 loopState.assistantMessage 会跳过提示分支（循环检测/maxTurns 下消息缺失）。 */
  getAssistantMessage(): Message {
    return this.finalize();
  }

  /** 供转换层聚合心跳（M1c）：已完成工具名（去重）+ 执行总次数 */
  getHeartbeatData(): {
    completedToolNames: string[];
    totalCompletedToolCount: number;
  } {
    return {
      completedToolNames: [...this.loopState.completedToolNames],
      totalCompletedToolCount: this.loopState.totalCompletedToolCount,
    };
  }

  /** 取走并清空待产出的 todo 数据（M1c：供调用点转 todo chunk，对齐旧类 yield todo） */
  getPendingTodos(): TodoBlockData[] {
    const todos = this.loopState.pendingTodos;
    this.loopState.pendingTodos = [];
    return todos;
  }
}
