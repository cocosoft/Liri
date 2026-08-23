// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * streamMessageFlow — 流式消息编排阶段管线（ChatManager 拆分第 4 步）
 *
 * 从 ChatManager.streamMessage（~620 行）+ _prepareStreamSession（~145 行）
 * + _finalizeStreamMessage（~226 行）提取。
 * 编排顺序由 runStreamMessage 控制，各阶段为纯函数。
 */

import { getLogger } from '@modules/monitoring';
import { mergeCompactionRanges } from '@modules/session/storage/EventMessageDeriver';
import {
  handleError,
  AppError,
  ErrorCategory,
  ErrorSeverity,
} from '@modules/error';
import { configManager } from '@modules/config';
import { SimpleMutex } from '@modules/core/SimpleMutex';
import { PlainTextCheckpoint } from '../services/PlainTextCheckpoint.js';
import { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint.js';
import {
  createMaxOutputRetryState,
  advanceMaxOutputRetry,
  type MaxOutputRetryState,
} from '../../ai/MaxOutputRetryHandler';
import {
  createDegradationState,
  tryDegradeContext,
  getDegradationWarning,
  type DegradationState,
} from '../../ai/ContextDegradation';
import { resolveMaxContextTokens, toUsageInfo } from '../services/ChatHelper';
import {
  estimateMessagesTokens,
  estimateMessagesTokensCooperative,
} from '../../ai/tokenizer/TokenEstimator';
import {
  logTokenSnapshot,
  applyPreSendProtection,
  applyErrorCalibration,
  logInferenceUsage,
  createStreamLoopStats,
  beginStreamLoop,
  countStreamChunk,
  logStreamLoopDone,
  logFinalRawResponse,
} from './preSendContextProtection.js';
import { savePlainTextCheckpoint } from './plainTextCheckpointSave.js';
import { compactionOrchestrator } from '../../context/compaction/CompactionOrchestrator';
import { autoCompactionPolicy } from '../../context/compaction/AutoCompactionPolicy';
import { getOTelTracing } from '@modules/monitoring';
import { trajectoryRecorder } from '../../agent/trajectory/TrajectoryRecorder';
import { trajectoryRuntime } from '../../core/trajectory/TrajectoryRuntime.js';
import { agentTelemetry } from '../../agent/AgentTelemetry.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';
import { getToolExecErrorMessage } from './toolErrorMessages.js';
import { filterToolsByTask } from '../../tools/toolCategories.js';
import { isLocalLlmEndpoint } from '../services/ChatHelper.js';
import type { Message, StreamMessageOptions } from '../types/message.js';
import type { ChatResponse } from '../types/message.js';
import type { ChatSession } from '../types/session.js';
import type { ToolResult } from '../types/tool.js';
import type { ToolDefinition, ParsedToolCall } from '@modules/ai';
import type { ChatMessage, ThinkingProviderChunk } from '@modules/ai';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';

const logger = getLogger('chat:streamFlow');

/**
 * 定时等待（保活心跳轮询用）。
 * 2026-08-19 Fix A：准备阶段（API 消息构建/协作式估算）与模型首块等待（TTFB）期间，
 * 用 setTimeout 定时间隔轮询并发任务，每 10s 向 SSE 发射一次 status 心跳，
 * 防止大会话准备 + 思考模型 TTFB 超过前端 60s 空闲超时被误判为"流式响应超时"。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 归一化（CS01）：压缩区间合并统一复用 EventMessageDeriver.mergeCompactionRanges
// （写路径持久化 metadata 与读路径派生共用，避免两处重复维护）。

/**
 * 流式编排入口 — 由 ChatOrchestrator.streamMessage 委托
 */
export async function* runStreamMessage(
  host: ChatOrchestratorHost,
  content: string,
  options?: StreamMessageOptions
): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
  const {
    _prepareStreamSession,
    _buildApiMessagesForStream,
    _createStreamPipeline,
    _finalizeStreamMessage,
  } = host;

  // P2-3.5: 流式消息预处理
  const ctx = await _prepareStreamSession(content, options);
  const session = ctx.session;
  // 1.6：流式开始时间（落盘 startedAt，导出显示开始时间+耗时）
  const streamStartedAt = new Date();

  // P1-2（2026-08-23）：首轮 assistant 消息 id——优先前端透传（options.assistantMessageId），
  // 缺失时预生成兜底 id（N3/A3）。必须在此处（首个 appendStreamEvent 之前）确定，
  // 保证首轮 text/thinking chunk 事件从第一个 chunk 起就带 messageId，
  // 并在流式结束 createAssistantMessage 时复用同一 id（L1019）。
  const assistantMessageId =
    options?.assistantMessageId ??
    `msg-turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // P2（08-09）：普通对话轻量检查点（try 外声明，finally 可访问）
  const plainTextCheckpoint = new PlainTextCheckpoint(
    host.checkpointService,
    session.id
  );

  const streamSpan = ctx.streamSpan;
  const streamAbortController = ctx.streamAbortController;
  const streamingCheckpoint = ctx.streamingCheckpoint;
  const mutex = ctx.mutex;
  const userMessage = ctx.userMessage;

  // BUG-1 修复：mutexHeld 必须在 try 外声明——finally 块是 try 的子句，
  // 与 try Block 平行，看不到 try 块内声明的 let（此前 tsc 报 Cannot find name）。
  // 声明后供 try 内 acquire（置 true）与最外层 finally（释放）共享。
  let mutexHeld = false;

  try {
    streamSpan.addEvent('streamMessage.start', {
      'session.id': session.id,
      model: options?.model ?? 'unknown',
      'content.length': ctx.content.length,
    });

    // === TRAE 式上下文准备（2026-08-19）：回合开始先读上下文，达到压缩条件则先压缩再构建 ===
    // 1) 发射"读取上下文"状态块（前端可见，类似工具调用），大历史准备期间用户能感知处理进度
    yield {
      type: 'status',
      statusType: 'compaction',
      phase: 'compacting',
      content: '正在读取上下文...',
      sessionId: session.id,
    } as ChatStreamChunk;

    // 2) 协作式评估原始历史是否达到压缩条件（Fix C：先压缩再构建，
    //    避免 ~100 万 token 全量构建；evaluateAsync 分批让出事件循环不阻塞）
    // 耗时日志（2026-08-19 超时排查）：记录评估开始/结束 + 决策快照，
    // 与 TokenEstimator 的 estimate:cooperative_total_done（debug）串联定位评估耗时
    const preEvalStart = Date.now();
    logger.info('compaction:pre_eval_start', {
      sessionId: session.id,
      model: options?.model ?? 'unknown',
      messageCount: session.messages.length,
    });
    const preCompactEval = await autoCompactionPolicy.evaluateAsync(
      session.messages as unknown as ChatMessage[],
      options?.model || ''
    );
    logger.info('compaction:pre_eval_done', {
      sessionId: session.id,
      elapsedMs: Date.now() - preEvalStart,
      decision: preCompactEval.decision,
      tokens: preCompactEval.snapshot.tokens,
      maxTokens: preCompactEval.snapshot.maxTokens,
      ratio: Number(preCompactEval.snapshot.ratio.toFixed(3)),
      messageCount: session.messages.length,
    });
    let preCompacted = false;
    if (preCompactEval.decision !== 'skip') {
      // 达到压缩条件 → 发射"压缩中"状态块（带水位信息，前端脉冲动画）
      yield {
        type: 'status',
        statusType: 'compaction',
        phase: 'compacting',
        content: `上下文水位 ${Math.round(preCompactEval.snapshot.ratio * 100)}%（${(preCompactEval.snapshot.tokens / 1000).toFixed(0)}K/${(preCompactEval.snapshot.maxTokens / 1000).toFixed(0)}K tokens），正在压缩历史...`,
        sessionId: session.id,
      } as ChatStreamChunk;
      // 耗时日志：预压缩执行（Tier1/2 应毫秒级，Tier3 已被 skipTier3Sync 推迟后台）
      const preCompactStart = Date.now();
      logger.info('compaction:pre_compact_start', {
        sessionId: session.id,
        messageCount: session.messages.length,
        decision: preCompactEval.decision,
        skipTier3Sync: true,
      });
      const preCompactResult = await compactionOrchestrator.compact(
        session.messages as unknown as ChatMessage[],
        { model: options?.model || '', sessionId: session.id },
        { skipTier3Sync: true, preEvaluated: preCompactEval }
      );
      logger.info('compaction:pre_compact_done', {
        sessionId: session.id,
        elapsedMs: Date.now() - preCompactStart,
        applied: preCompactResult.applied,
        beforeMessageCount: session.messages.length,
        afterMessageCount: preCompactResult.messages.length,
      });
      if (preCompactResult.applied) {
        // A-1/A-4（2026-08-23）：压缩 applied 时写 context/compaction 事件 + 持久化区间表；
        // **事件写成功才提交投影压缩**（写回 session.messages），失败则不提交 + 告警（A-4）。
        // 压缩输入是 session.messages（Message[] 含 lastEventSeq），压缩策略 `{...msg}` 保留
        // 运行时字段；压缩产物（summary 消息）为 after 中无 lastEventSeq 的新消息。
        //
        // 回滚开关（规格书 §二 回滚）：EVENT_SOURCE_COMPACT='false' 时跳过压缩事件写入与
        // 区间表持久化（回到纯投影压缩，用于紧急回滚）；默认开启。
        const eventSourceCompact =
          configManager.env('EVENT_SOURCE_COMPACT') !== 'false';
        let compactionCommitted = false;
        try {
          if (eventSourceCompact) {
            const beforeMsgs = session.messages;
            const afterMsgs = preCompactResult.messages as unknown as Array<{
              content?: string;
              lastEventSeq?: number;
            }>;
            const beforeSeqs = beforeMsgs
              .map(
                (m) => (m as unknown as { lastEventSeq?: number }).lastEventSeq
              )
              .filter((n): n is number => typeof n === 'number');
            const afterSeqs = new Set(
              afterMsgs
                .map((m) => m.lastEventSeq)
                .filter((n): n is number => typeof n === 'number')
            );
            const compressedSeqs = beforeSeqs.filter((s) => !afterSeqs.has(s));
            if (compressedSeqs.length > 0) {
              const compactedRange = {
                startSeq: Math.min(...compressedSeqs),
                endSeq: Math.max(...compressedSeqs),
              };
              // summary 消息 = after 中无 lastEventSeq 的新消息（压缩产物）
              const summaryMsg = afterMsgs.find(
                (m) => m.lastEventSeq === undefined
              );
              const summary =
                typeof summaryMsg?.content === 'string'
                  ? summaryMsg.content
                  : '';
              const summaryMessageId = (
                summaryMsg as unknown as { id?: string }
              )?.id;
              const ts = await host.getStreamTailSeq(session.id);
              const appendResult = await host.appendStreamEvent(session.id, {
                type: 'context/compaction',
                schemaVersion: 1,
                seq: ts + 1,
                time: Date.now(),
                sessionId: session.id,
                data: {
                  phase: 'done',
                  compactedRange,
                  summary,
                  summaryMessageId,
                  beforeTokens: preCompactEval.snapshot.tokens,
                  afterTokens: estimateMessagesTokens(
                    preCompactResult.messages as unknown as ChatMessage[]
                  ),
                },
              });
              if (!appendResult.ok) {
                throw new Error(
                  `appendStreamEvent failed: ${appendResult.reason ?? 'unknown'}`
                );
              }
              // 持久化压缩区间表到会话 metadata（派生器优先读 metadata，修剪删压缩事件不丢区间）
              const existing = (session.metadata as Record<string, unknown>)
                .trajectoryCompactions as
                | Array<{
                    startSeq: number;
                    endSeq: number;
                    summaryMessageId?: string;
                  }>
                | undefined;
              session.metadata = {
                ...session.metadata,
                trajectoryCompactions: mergeCompactionRanges([
                  ...(existing ?? []),
                  { ...compactedRange, summaryMessageId },
                ]),
              };
              logger.info('compaction:已写 context/compaction 事件', {
                sessionId: session.id,
                compactedRange,
                summaryLen: summary.length,
                summaryMessageId,
                compressedCount: compressedSeqs.length,
              });
            }
          }
          // 事件写成功（或无被压缩消息）→ 提交投影压缩（写回会话）
          compactionCommitted = true;
          session.messages =
            preCompactResult.messages as unknown as typeof session.messages;
          preCompacted = true;
        } catch (err) {
          // @ignore-catch — 压缩事件写入失败不阻断流式（CS03）；**不提交投影压缩**（A-4，保持一致性），
          // 派生器回退事件补充/投影兜底；pendingRepair 由 T-B 处理
          logger.warn(
            'compaction:写 context/compaction 事件失败，不提交投影压缩',
            {
              sessionId: session.id,
              error: err instanceof Error ? err.message : String(err),
            }
          );
        }
        if (compactionCommitted) {
          const afterTokens = estimateMessagesTokens(
            preCompactResult.messages as unknown as ChatMessage[]
          );
          const savedPercent =
            preCompactEval.snapshot.tokens > 0
              ? Math.round(
                  (1 - afterTokens / preCompactEval.snapshot.tokens) * 100
                )
              : 0;
          yield {
            type: 'status',
            statusType: 'compaction',
            phase: 'done',
            content: `上下文已压缩: ${preCompactEval.snapshot.tokens.toLocaleString()} → ${afterTokens.toLocaleString()} tokens（节省 ${savedPercent}%）`,
            sessionId: session.id,
          } as ChatStreamChunk;
        }
      }
    }

    // 3) 构建 API 格式消息列表（Fix C：基于可能已压缩的历史）
    // 2026-08-19 根因①修复：构建改为异步（内部批量让出事件循环），避免大会话阻塞；
    // 构建期间每 10s 心跳保活（Fix A），同内容状态块前端去重只保留一条，但每次收到
    // 数据都会重置前端空闲超时计时器
    // 耗时日志（2026-08-19 超时排查）：构建开始/结束 + 心跳次数——若构建阻塞
    // 事件循环，心跳会被拖慢，heartbeatCount 能反映"阻塞了几轮 10s"辅助定位
    let apiMessages: Array<Record<string, unknown>>;
    {
      const buildStart = Date.now();
      let buildHeartbeatCount = 0;
      logger.info('compaction:build_start', {
        sessionId: session.id,
        messageCount: session.messages.length,
        preCompacted,
      });
      const buildPromise = _buildApiMessagesForStream(session.messages);
      while (true) {
        const settled = await Promise.race([
          buildPromise.then((v) => ({ done: true as const, value: v })),
          sleep(10_000).then(() => ({ done: false as const, value: null })),
        ]);
        if (settled.done) {
          apiMessages = settled.value;
          break;
        }
        buildHeartbeatCount++;
        yield {
          type: 'status',
          statusType: 'compaction',
          phase: 'compacting',
          content: '正在读取上下文...',
          sessionId: session.id,
        } as ChatStreamChunk;
      }
      // 2026-08-20 QQ 空响应事故防御：发送前清洗历史污染。
      // 根因：旧版 persistMessages 全量重写 bug（P0-2 修复前）在渠道会话落盘了
      // 同毫秒批量 assistant 副本；DeepSeek 收到"连续多条 assistant（无 user
      // 间隔）/空 assistant"会直接返回空响应（chunkCount=0, finishReason=stop），
      // 用户侧表现为长时间沉默。清洗规则：
      //   a) 丢弃空 assistant（content 空/null 且无 tool_calls）
      //   b) 合并连续纯文本 assistant（换行拼接；带 tool_calls 的不合并，
      //      其后必须紧跟 tool 结果，合并会破坏调用序列）
      const beforeSanitize = apiMessages.length;
      let droppedEmpty = 0;
      let mergedRuns = 0;
      const sanitized: Array<Record<string, unknown>> = [];
      for (const msg of apiMessages) {
        const role = msg.role as string;
        const content = msg.content;
        const hasToolCalls =
          Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
        // 规则 a：空 assistant 丢弃
        if (
          role === 'assistant' &&
          !hasToolCalls &&
          (content === null ||
            content === undefined ||
            (typeof content === 'string' && content.trim() === ''))
        ) {
          droppedEmpty++;
          continue;
        }
        const prev = sanitized[sanitized.length - 1];
        // 规则 b：连续纯文本 assistant 合并
        if (
          role === 'assistant' &&
          !hasToolCalls &&
          typeof content === 'string' &&
          prev &&
          prev.role === 'assistant' &&
          !Array.isArray(prev.tool_calls)
        ) {
          prev.content = `${prev.content}\n${content}`;
          mergedRuns++;
          continue;
        }
        sanitized.push({ ...msg });
      }
      if (droppedEmpty > 0 || mergedRuns > 0) {
        apiMessages = sanitized;
        logger.warn('compaction:历史污染清洗（发送前防御）', {
          sessionId: session.id,
          beforeCount: beforeSanitize,
          afterCount: apiMessages.length,
          droppedEmptyAssistant: droppedEmpty,
          mergedConsecutiveAssistant: mergedRuns,
          hint: '历史含旧版全量重写 bug 落盘的重复/空 assistant，已清洗防止 LLM 空响应',
        });
      }
      logger.info('compaction:build_done', {
        sessionId: session.id,
        elapsedMs: Date.now() - buildStart,
        beforeMessageCount: session.messages.length,
        apiMessageCount: apiMessages.length,
        heartbeatCount: buildHeartbeatCount,
      });
    }
    // 诊断日志：压缩前 token 基线
    await logTokenSnapshot(
      'API 消息构建后（压缩前）',
      session.id,
      options?.model ?? 'unknown',
      apiMessages
    );

    // 管线 — 图片路径注册 + 文件路径提取
    const pipeline = _createStreamPipeline(session, ctx.content, options);
    pipeline.ctx.apiMessages = apiMessages;
    await pipeline.registerImages();
    streamSpan.addEvent('streamMessage.pipeline.imagesRegistered');
    host.sanitizeApiMessages(apiMessages);

    // 工具定义
    const toolRegistry = host.getToolRegistry();
    const toolDefinitions: ToolDefinition[] = toolRegistry
      ? host.buildToolDefinitions(toolRegistry.getToolSchemas())
      : [];
    if (toolDefinitions.length === 0) {
      // 诊断埋点：工具定义为空时明确记录，区分"注册表缺失" vs "注册表内无工具"，
      // 避免"模型想调工具却无工具可用 → think-only"被静默掩盖
      logger.warn('streamMessage: 工具定义为空，模型无法调用任何工具', {
        sessionId: session.id,
        registryPresent: !!toolRegistry,
        schemaCount: toolRegistry?.getToolSchemas().length ?? 0,
      });
    }

    // Step 3（2026-08-22）：按任务裁剪工具集——全量工具定义（50+ 个，~10K tokens）
    // 在小上下文（llama.cpp 8K）下放不进，preSendProtection 只能整体移除 → 模型无工具可用。
    // 任务类型优先级：调用方显式 metadata.taskType > 本地 LLM 端点（llama.cpp/ollama，工具
    // 能力弱）→ 'local' 只读轻量集 > undefined（default 保底集）。
    if (toolDefinitions.length > 0) {
      const baseUrl = (
        host.getClientForModel(options?.model) as unknown as {
          getBaseUrl?: () => string;
        }
      )?.getBaseUrl?.();
      const explicitTaskType = (
        options?.metadata as Record<string, unknown> | undefined
      )?.taskType;
      const taskType =
        (typeof explicitTaskType === 'string' && explicitTaskType
          ? explicitTaskType
          : undefined) ??
        (baseUrl && isLocalLlmEndpoint(baseUrl) ? 'local' : undefined);
      const filteredTools = filterToolsByTask(toolDefinitions, taskType);
      if (filteredTools.length !== toolDefinitions.length) {
        logger.info('streamMessage:tools — 按任务裁剪工具集', {
          sessionId: session.id,
          taskType: taskType ?? 'default',
          before: toolDefinitions.length,
          after: filteredTools.length,
          removedNames: toolDefinitions
            .filter((t) => !filteredTools.includes(t))
            .map((t) => t.function?.name ?? ''),
        });
        toolDefinitions.length = 0;
        toolDefinitions.push(...filteredTools);
      }
    }

    // 触发 ChatPreStream Hook
    await pipeline.preStreamHook();

    const hasSystemMessage = apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    if (!hasSystemMessage) {
      await pipeline.assembleSystemPrompt(
        host.getOrAssembleSystemPrompt.bind(host)
      );
    }

    let assistantMessage: Message | undefined;
    let accumulatedContent = '';
    let finalResponse: ChatResponse | null = null;

    if (!host.getLLMClient()) {
      throw new Error('LLM client not initialized');
    }
    const activeClient = host.getClientForModel(options?.model);

    // 管线 — 上下文压缩
    const compactInfo = await pipeline.compactContext();
    // BUG 修复：compactContext 内部可能替换 this.ctx.apiMessages 引用（压缩后新数组），
    // 局部 apiMessages 变量仍是旧引用，必须重新同步，否则发送的仍是未压缩的完整历史
    // （llama.cpp 等小上下文模型会因 15408 > n_ctx 4096 直接 400）。
    apiMessages = pipeline.ctx.apiMessages;
    // 前端可见性（2026-08-19）：压缩"完成"状态块已由回合开始处的预压缩路径发射
    // （preCompacted 分支）；此处仅当"预压缩未生效"且 compactContext 兜底压缩成功时补发，
    // 避免双份"上下文已压缩"噪声。仅 applied && savedPercent>0 展示，skip 时不产生无意义噪声
    if (!preCompacted && compactInfo.applied && compactInfo.savedPercent > 0) {
      yield {
        type: 'status',
        statusType: 'compaction',
        phase: 'done',
        content: `上下文已压缩: ${compactInfo.beforeTokens.toLocaleString()} → ${compactInfo.afterTokens.toLocaleString()} tokens（节省 ${compactInfo.savedPercent}%）`,
        sessionId: session.id,
      } as ChatStreamChunk;
    }
    // 诊断日志：压缩后 token 变化
    await logTokenSnapshot(
      '上下文压缩后',
      session.id,
      options?.model ?? 'unknown',
      apiMessages
    );
    streamSpan.addEvent('streamMessage.pipeline.contextCompacted', {
      'message.count': apiMessages.length,
    });

    // 发送前上下文保护（估算截断 + llama.cpp 精确截断 + 工具预算检查）
    await applyPreSendProtection({
      host,
      apiMessages,
      toolDefinitions,
      activeClient,
      options,
      session,
    });
    // 诊断日志：发送前强制截断后的 token（兜底保护结果）
    await logTokenSnapshot(
      '发送前兜底截断后',
      session.id,
      options?.model ?? 'unknown',
      apiMessages
    );

    // Phase 2: Telemetry + Trajectory THINK 开始
    const streamLlmStartTime = Date.now();
    if (host.ENABLE_TELEMETRY) {
      try {
        agentTelemetry.startTurn(
          session.id,
          options?.model ?? '',
          host.toolRoundCount + 1
        );
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (host.ENABLE_TRAJECTORY) {
      try {
        trajectoryRecorder.recordStep(session.id, {
          phase: 'thinking',
          input: ctx.content.slice(0, 500),
          modelName: options?.model,
        });
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 缺陷 C 修复: 推理前容量预检
    if (options?.model) {
      const preCheck = await host.unifiedTracker.checkBeforeRequest(
        apiMessages as unknown as readonly {
          role?: string;
          content?: string | unknown;
        }[],
        options.model,
        options?.maxTokens
      );
      if (preCheck.decision !== 'skip') {
        logger.warn('compaction:preemptive_check', {
          sessionId: session.id,
          decision: preCheck.decision,
          beforeTokens: preCheck.beforeTokens,
        });
        if (preCheck.decision === 'trigger') {
          options?.onProgress?.({
            stage: 'generating',
            message: `上下文空间不足（预计 ${preCheck.beforeTokens.toLocaleString()} tokens），建议手动压缩`,
          });
        }
      }
    }

    // P2-12: max_output 加倍重试
    const MAX_OUTPUT_RETRY_CFG = { maxRetries: 3, maxOutputLimit: 64000 };
    const initialMaxTokens = (options?.maxTokens as number | undefined) ?? 4096;
    let retryState: MaxOutputRetryState = createMaxOutputRetryState(
      initialMaxTokens,
      MAX_OUTPUT_RETRY_CFG
    );

    // P1-7: 上下文溢出渐进降级
    const initialCtxLimit = resolveMaxContextTokens(options?.model);
    // 发送前截断上限（与 applyPreSendProtection 内部一致，用于重试轮次日志）
    const sendCtxLimit = initialCtxLimit;
    let ctxDegradation: DegradationState =
      createDegradationState(initialCtxLimit);

    let streamHadError = false;
    // 流式统计（跨重试轮次，循环外声明供结束后日志使用）
    const streamStats = createStreamLoopStats();
    // P0-fix: 防止重试循环重复写入 turn/start 事件
    // 当发生重试时（continue 或重新开始），不会重复写入相同 turn 编号的 turn/start
    let turnStarted = false;
    // P0-fix-2（2026-08-23）：缓存本 turn 的编号（turn/start 从事件日志恢复后写入，
    // turn/end 复用同一编号，保证 start/end 一致且重启后不重复）
    let currentTurnNo = 0;
    // P2 修复（AB-1）：mutex 仅首轮获取（重试轮重复 acquire 会因 release 未执行而 30s 超时）
    // （mutexHeld 声明于 try 外，见函数头部 BUG-1 注释）
    while (true) {
      streamHadError = false;
      host.unifiedTracker.resetStreamTokens();
      streamSpan.addEvent('streamMessage.llm.call', {
        'retry.count': retryState.retryCount,
        maxTokens: retryState.nextMaxTokens,
        'message.count': apiMessages.length,
      });
      // 诊断日志：实际发送前的 token 估算（含降级重试轮次，观察重试是否带上被截断后的消息）
      // 2026-08-19 根因①修复：改协作式估算，避免重试轮也同步阻塞
      const preSendEstimate = await estimateMessagesTokensCooperative(
        apiMessages as unknown as readonly {
          role?: string;
          content?: string | unknown;
        }[]
      );
      logger.info('streamMessage:token — 实际发送前', {
        sessionId: session.id,
        model: options?.model ?? 'unknown',
        retryCount: retryState.retryCount,
        messageCount: apiMessages.length,
        estimateTokens: preSendEstimate,
        sendCtxLimit,
      });
      const gen = activeClient.streamMessage(
        apiMessages as unknown as ChatMessage[],
        {
          ...options,
          maxTokens: retryState.nextMaxTokens,
          signal: streamAbortController.signal,
          tools:
            toolDefinitions.length > 0
              ? (toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      beginStreamLoop(streamStats);
      // Fix A（2026-08-19）：等待模型首块（TTFB）期间每 10s 心跳保活——思考模型
      // （如 glm-5.2）TTFB 可达数十秒，叠加准备阶段后易击穿前端 60s 空闲超时；
      // 首块到达即退出轮询，后续流式块之间一般远小于空闲超时
      // Fix B（2026-08-20）：增加 TTFB 硬超时（默认 300s），防止 llama-server
      // 接受 TCP 但不返回响应头时无限等待（超时盲区：fetch→响应头阶段无超时保护）
      let result: Awaited<ReturnType<typeof gen.next>>;
      {
        const TTFB_MAX_WAIT_MS = Number(
          configManager.env('TTFB_MAX_WAIT_MS') ?? '300000'
        );
        const ttfbStart = Date.now();
        let ttfbHeartbeatCount = 0;
        const firstNextPromise = gen.next();
        while (true) {
          const elapsedMs = Date.now() - ttfbStart;
          if (elapsedMs > TTFB_MAX_WAIT_MS) {
            logger.error('compaction:ttfb_timeout', {
              sessionId: session.id,
              elapsedMs,
              heartbeatCount: ttfbHeartbeatCount,
              model: options?.model ?? 'unknown',
              maxWaitMs: TTFB_MAX_WAIT_MS,
              apiMessageCount: apiMessages.length,
            });
            throw new AppError(
              `模型首块响应超时（已等待 ${Math.round(elapsedMs / 1000)}s），可能原因：模型加载中、内存不足或服务未就绪。建议检查 llama-server 状态或更换较小模型。`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              'LLM_TTFB_TIMEOUT'
            );
          }
          const remainingSec = Math.max(
            0,
            Math.round((TTFB_MAX_WAIT_MS - elapsedMs) / 1000)
          );
          const settled = await Promise.race([
            firstNextPromise.then((v) => ({ done: true as const, value: v })),
            sleep(10_000).then(() => ({ done: false as const, value: null })),
          ]);
          if (settled.done) {
            result = settled.value;
            break;
          }
          ttfbHeartbeatCount++;
          yield {
            type: 'status',
            statusType: 'compaction',
            phase: 'compacting',
            content: `等待模型响应（首块）... [剩余超时: ${remainingSec}s]`,
            sessionId: session.id,
          } as ChatStreamChunk;
        }
        logger.info('compaction:ttfb_done', {
          sessionId: session.id,
          elapsedMs: Date.now() - ttfbStart,
          heartbeatCount: ttfbHeartbeatCount,
          model: options?.model ?? 'unknown',
          apiMessageCount: apiMessages.length,
        });
      }

      // Phase 1c: 流式水位监测
      // P1 修复（2026-08-14 排查）：水位告警刷屏降噪——定时器每 1.5s 触发一次，
      // 原实现无条件 logger.warn（normal 级别也在刷，24h 日志膨胀 12.6MB+）。
      // 复用 severity 分级：normal 降为 debug，仅 warn/compact 记录告警。
      // P2（2026-08-14 排查）：warn 级仍 1.5s 一条会淹没其他日志 → warn 节流 15s，
      // compact（触发压缩的关键告警）保持全量记录。
      let lastWatermarkWarnAt = 0;
      host.unifiedTracker.startStreamingCheck((state) => {
        const logPayload = {
          sessionId: session.id,
          currentTokens: state.currentTokens,
          contextLimit: state.contextLimit,
          ratio: Number(state.ratio.toFixed(3)),
          severity: state.severity,
        };
        if (state.severity === 'normal') {
          logger.debug('流式输出中上下文水位（normal）', logPayload);
        } else if (state.severity === 'warn') {
          const now = Date.now();
          if (now - lastWatermarkWarnAt >= 15_000) {
            lastWatermarkWarnAt = now;
            logger.warn('流式输出中上下文水位告警', logPayload);
          }
        } else {
          logger.warn('流式输出中上下文水位告警', logPayload);
        }
        const pct = Math.round(state.ratio * 100);
        const curK =
          state.currentTokens > 0
            ? `${(state.currentTokens / 1000).toFixed(0)}K`
            : '?';
        const maxK =
          state.contextLimit > 0
            ? `${(state.contextLimit / 1000).toFixed(0)}K`
            : '?';
        options?.onProgress?.({
          stage: 'generating',
          message: `上下文水位: ${pct}% (${curK}/${maxK}) | severity:${state.severity} | ratio:${state.ratio.toFixed(3)} | tokens:${state.currentTokens}/${state.contextLimit}`,
          watermarkState: {
            currentTokens: state.currentTokens,
            contextLimit: state.contextLimit,
            ratio: state.ratio,
            severity: state.severity,
          },
        });
      });

      if (!mutexHeld) {
        logger.info('获取互斥锁(首轮)', { sessionId: session.id });
        await mutex.acquire();
        mutexHeld = true;
      }

      // M1 事件溯源：流式开始前追加 turn/start 事件
      // turn 编号使用 toolRoundCount+1（与现有计数器对齐）
      // P0-fix: 仅首轮写入 turn/start，重试时跳过（避免重复写入相同 turn 编号）
      // P0-fix-2（2026-08-23）：turn 编号改用事件日志恢复的最大 turn+1，
      // 避免后端重启后 _toolRoundCount 归零导致 turn 编号从 1 重复（前端误判重复回放删除新对话）。
      if (!turnStarted) {
        let streamTurnSeq = 0;
        try {
          const tailSeq = await host.getStreamTailSeq(session.id);
          streamTurnSeq = tailSeq + 1;
          // 从事件日志恢复最大 turn（重启后继续递增），兜底取内存计数器的较大值
          const [persistedTurn, memTurn] = await Promise.all([
            host.getStreamMaxTurn(session.id),
            Promise.resolve(host.toolRoundCount),
          ]);
          const nextTurn = Math.max(persistedTurn, memTurn) + 1;
          currentTurnNo = nextTurn;
          await host.appendStreamEvent(session.id, {
            type: 'turn/start',
            seq: streamTurnSeq,
            time: Date.now(),
            sessionId: session.id,
            data: { turn: nextTurn },
          });
          turnStarted = true;
        } catch (e) {
          // @ignore-catch — 事件追加失败不阻断流式（CS03）
          logger.debug('streamMessageFlow: turn/start 追加失败', {
            sessionId: session.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      try {
        while (!result.done) {
          const chunk = result.value as string | ThinkingProviderChunk;
          if (typeof chunk === 'string') {
            countStreamChunk(streamStats, false);
            accumulatedContent += chunk;
            host.unifiedTracker.onStreamChunk(chunk);

            // M1 事件溯源：text chunk 追加为 assistant/text 事件
            try {
              const ts = await host.getStreamTailSeq(session.id);
              await host.appendStreamEvent(session.id, {
                type: 'assistant/text',
                schemaVersion: 1,
                seq: ts + 1,
                time: Date.now(),
                sessionId: session.id,
                data: { content: chunk, messageId: assistantMessageId },
              });
            } catch {
              // @ignore-catch — 事件追加失败不阻断流式
            }

            yield {
              type: 'text',
              content: chunk,
              sessionId: session.id,
              messageId: assistantMessageId,
            };
          } else if (chunk?.type === 'thinking') {
            countStreamChunk(streamStats, true);
            if (chunk.content) {
              host.unifiedTracker.onStreamChunk(
                typeof chunk.content === 'string'
                  ? chunk.content
                  : JSON.stringify(chunk.content)
              );
            }

            // M1 事件溯源：thinking chunk 追加为 assistant/thinking 事件
            try {
              const ts = await host.getStreamTailSeq(session.id);
              const thinkingContent =
                typeof chunk.content === 'string'
                  ? chunk.content
                  : JSON.stringify(chunk.content);
              await host.appendStreamEvent(session.id, {
                type: 'assistant/thinking',
                schemaVersion: 1,
                seq: ts + 1,
                time: Date.now(),
                sessionId: session.id,
                data: {
                  content: thinkingContent,
                  messageId: assistantMessageId,
                },
              });
            } catch {
              // @ignore-catch — 事件追加失败不阻断流式
            }

            const thinkingChunk: ChatStreamChunk = {
              type: 'thinking',
              content: chunk.content,
              sessionId: session.id,
              messageId: assistantMessageId,
            };
            yield thinkingChunk;
          }
          result = await gen.next();
        }
      } catch (genErr) {
        // 错误校准（估算 vs 真实对比 + 400 自动回写 DB）
        await applyErrorCalibration(
          genErr,
          apiMessages,
          session.id,
          options?.model
        );
        // P1-7: 上下文溢出降级
        const degradationResult = tryDegradeContext(ctxDegradation, genErr);
        if (degradationResult.shouldRetry) {
          logger.warn('chat:context_degraded — 降低上下文窗口重试', {
            sessionId: session.id,
            from: initialCtxLimit,
            to: degradationResult.limit,
            degradationCount: ctxDegradation.degradationCount,
          });
          const warning = getDegradationWarning(ctxDegradation);
          if (warning) {
            yield {
              type: 'context_state',
              content: warning,
              sessionId: session.id,
              watermarkState: {
                currentTokens: 0,
                contextLimit: degradationResult.limit,
                ratio: degradationResult.limit / ctxDegradation.originalLimit,
                severity:
                  degradationResult.limit / ctxDegradation.originalLimit <= 0.5
                    ? ('compact' as const)
                    : ('warn' as const),
              },
            } as ChatStreamChunk;
          }
          await host.truncateApiMessages(
            apiMessages,
            degradationResult.limit,
            session.id,
            options?.maxTokens
          );
          continue;
        }

        streamHadError = true;
        await handleError(genErr, {
          module: 'chat:ChatManager',
          action: 'streamMessage_genIteration',
          context: { sessionId: session.id },
        });
        const errorMsg =
          genErr instanceof Error
            ? genErr.message.slice(0, 200)
            : String(genErr).slice(0, 200);
        yield {
          type: 'error',
          content: `流式响应中断: ${errorMsg}`,
          sessionId: session.id,
        } as ChatStreamChunk;
      }

      if (!streamHadError) {
        finalResponse = result.value as unknown as ChatResponse;
        logFinalRawResponse(session.id, finalResponse);
      } else {
        finalResponse = { finishReason: 'error' } as unknown as ChatResponse;
        break;
      }

      // P2-12: 检查是否需要加倍重试
      // 防御：result.value 可能为 undefined（模型空响应），as 断言不改变运行时值，
      // 直接访问 .stop_reason 会抛 undefined is not an object，故用可选链降级。
      const aiStopReason = (
        finalResponse as unknown as { stop_reason?: string } | null
      )?.stop_reason;
      if (aiStopReason === 'max_tokens') {
        // 优化（2026-08-22）：max_tokens 截断且本轮无正文 → 跳过无效重试。
        // 典型场景：本地推理模型（DeepSeek-R1-Distill 等）思考过长，thinking 占满
        // 输出预算，正文始终为 0。此时重试只会让模型重新思考（仍会截断），
        // 属无效连环重试（曾致 4 次重试 / 173s / 空正文）。直接结束并明确提示。
        if (accumulatedContent.length === 0) {
          logger.warn(
            'maxOutputRetry: max_tokens 截断且无正文，跳过重试（推理模型思考过长）',
            {
              sessionId: session.id,
              retryCount: retryState.retryCount,
              currentMaxTokens: retryState.currentMaxTokens,
              model: options?.model,
            }
          );
          yield {
            type: 'status',
            content:
              '模型思考过长被输出上限截断，未生成正文。建议增大 maxTokens、减小上下文，或更换输出能力更强的模型后重试。',
            sessionId: session.id,
          } as ChatStreamChunk;
          retryState = { ...retryState, shouldRetry: false };
        } else {
          retryState = advanceMaxOutputRetry(
            'max_tokens',
            retryState,
            MAX_OUTPUT_RETRY_CFG
          );
        }
      } else {
        retryState = { ...retryState, shouldRetry: false };
      }

      if (!retryState.shouldRetry) break;

      logger.info('maxOutputRetry: retrying with increased maxTokens', {
        sessionId: session.id,
        retryCount: retryState.retryCount,
        nextMaxTokens: retryState.nextMaxTokens,
        previousContentLength: accumulatedContent.length,
      });
      yield {
        type: 'status',
        statusType: 'retry',
        content: `输出截断，正在以更大 token 限制重试（第 ${retryState.retryCount} 次，maxTokens=${retryState.nextMaxTokens}）...`,
        sessionId: session.id,
      } as ChatStreamChunk;
      accumulatedContent = '';
    }

    // M1 事件溯源：流式正常结束追加 turn/end 事件
    // P0-fix-3（2026-08-23，顺序错乱根因）：若本次回复带有工具调用，
    // 工具执行（ReActToolLoop）发生在 turn/end 写入之后，导致 tool/result 事件
    // 无 turn 包裹、出现在 turn 外（回放时工具结果与对话错位）。
    // 修复：有工具调用时延迟 turn/end，待工具循环结束后（下方工具循环块）补写。
    const hasToolCalls =
      Array.isArray(finalResponse?.tool_calls) &&
      finalResponse!.tool_calls.length > 0;
    if (!hasToolCalls) {
      try {
        const ts = await host.getStreamTailSeq(session.id);
        const finishReason = (finalResponse?.finishReason ?? 'stop') as
          | 'stop'
          | 'length'
          | 'tool_use'
          | 'error'
          | 'canceled';
        await host.appendStreamEvent(session.id, {
          type: 'turn/end',
          seq: ts + 1,
          time: Date.now(),
          sessionId: session.id,
          data: {
            // P0-fix-2：复用 turn/start 写入的编号（重启后从事件日志恢复，不重复）
            turn: currentTurnNo > 0 ? currentTurnNo : host.toolRoundCount + 1,
            finishReason,
          },
        });
      } catch {
        // @ignore-catch — 事件追加失败不阻断主流程
      }
    }

    streamSpan.addEvent('streamMessage.llm.done', {
      'content.length': accumulatedContent.length,
      finishReason: finalResponse?.finishReason ?? 'unknown',
      'toolCalls.count': finalResponse?.tool_calls?.length ?? 0,
      'usage.inputTokens':
        (finalResponse?.usage as Record<string, number> | undefined)
          ?.inputTokens ?? 0,
      'usage.outputTokens':
        (finalResponse?.usage as Record<string, number> | undefined)
          ?.outputTokens ?? 0,
    });

    logStreamLoopDone(
      streamStats,
      session.id,
      finalResponse?.finishReason ?? 'unknown',
      finalResponse?.tool_calls?.length ?? 0,
      {
        model: options?.model ?? 'unknown',
        retryCount: retryState.retryCount,
        accumulatedContentLength: accumulatedContent.length,
      }
    );

    // 诊断日志：发送前估算 vs 发送后 API 返回真实 usage（闭环对比截断/压缩效果）
    await logInferenceUsage(
      session.id,
      options?.model ?? 'unknown',
      finalResponse,
      apiMessages
    );

    // 管线 — 内容修复 + 输出（repairContent 从 ctx.accumulatedContent 读取，须先同步局部累积）
    pipeline.ctx.accumulatedContent = accumulatedContent;
    const finalContent = pipeline.repairContent();
    options?.onStream?.(finalContent);
    // 管线 — 用量记录
    pipeline.recordUsage();

    // Phase 2: Telemetry + Trajectory THINK 完成
    const streamLlmDuration = Date.now() - streamLlmStartTime;
    if (host.ENABLE_TELEMETRY) {
      try {
        agentTelemetry.recordTokens(
          session.id,
          finalResponse?.usage?.inputTokens ?? 0,
          finalResponse?.usage?.outputTokens ?? 0
        );
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (host.ENABLE_TRAJECTORY) {
      try {
        trajectoryRecorder.recordStep(session.id, {
          phase: 'response',
          output:
            typeof accumulatedContent === 'string'
              ? accumulatedContent.slice(0, 500)
              : '',
          tokensUsed:
            (finalResponse?.usage?.inputTokens ?? 0) +
            (finalResponse?.usage?.outputTokens ?? 0),
          durationMs: streamLlmDuration,
        });
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 通知外部：本次 LLM 响应的词元用量
    pipeline.notifyUsage();

    // 创建助手消息
    // P0 根治（2026-08-14）：复用前端透传的 assistantId（如存在），
    // 使前端 updateMessageBlocks(assistantId) 直接命中，不再依赖兜底取最后一条 assistant。
    // P1-2（2026-08-23）：缺失时复用入口预生成的 assistantMessageId（N3/A3），
    // 保证 chunk 事件 messageId 与落盘消息 id 一致。
    assistantMessage = pipeline.createAssistantMessage(finalContent, {
      id: assistantMessageId,
    });
    // 排查日志：确认助手消息 ID 来源（前端透传 vs 后端自动生成）与内容规模
    logger.debug('streamMessageFlow:assistantMessage created', {
      sessionId: session.id,
      messageId: assistantMessage.id,
      idSource: options?.assistantMessageId
        ? 'frontend_passthrough'
        : 'auto_generated',
      contentLength: finalContent.length,
    });
    assistantMessage.startedAt = streamStartedAt; // 1.6：回填流式开始时间（createdAt 为完成时间）
    // 关键修复：标记此消息已通过 appendStreamEvent 流式写入了 thinking/text/tool_call chunk。
    // ChatManager._appendEventsForMessage 将仅对带此标记的消息跳过 convertMessage 生成的完整
    // text/thinking 事件，避免流式 chunk 与完整正文双份写入。
    // 非流式生成的消息（如 ReAct reason 回填、非流式 API 返回、会话恢复重建）
    // 不会有此标记，必须完整写入 text/thinking 到 events.jsonl，
    // 否则前端回放时 content 为空 → 触发"生成中断"误报。
    assistantMessage.metadata = {
      ...(assistantMessage.metadata ?? {}),
      __streamedEventsWritten: true,
    };

    // 管线 — 记忆提取 + 路径校验 + post hooks
    await pipeline.postProcess(ctx.content);

    // P2（08-09）：普通对话轻量检查点
    savePlainTextCheckpoint({
      checkpoint: plainTextCheckpoint,
      session,
      trigger: 'main',
      finishReason: finalResponse?.finishReason ?? 'unknown',
      contentLength: accumulatedContent.length,
      toolCalls: finalResponse?.tool_calls,
    });

    // 处理工具调用 — 流式工具执行循环
    try {
      if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
        streamSpan.addEvent('streamMessage.toolLoop.start', {
          'toolCalls.count': finalResponse.tool_calls.length,
          toolNames: finalResponse.tool_calls.map(
            (tc: ParsedToolCall) => tc.name
          ),
        });
        let currentMessages: Record<string, unknown>[] = [...apiMessages];
        let currentToolCalls: ParsedToolCall[] = [...finalResponse.tool_calls];
        let currentAssistantMsg = assistantMessage;
        const firstAssistantContent = String(assistantMessage.content ?? '');

        const { toolResultRegistry } =
          await import('../../tool/ToolResultRegistry');
        const rollbackRoundId = toolResultRegistry.nextRound(session.id);
        if (!session.metadata.roundIndex) session.metadata.roundIndex = {};
        session.metadata.roundIndex[userMessage.id] = rollbackRoundId;
        session.metadata.roundCounter = rollbackRoundId;

        await host
          .startRollbackRound(session.id, rollbackRoundId)
          .catch((err) => {
            logger.warn('回滚轮次启动失败', { error: String(err) });
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'rollback:startRound',
            }).catch(() => {});
          });

        // T2.3（2026-08-23）：tool_call 事件 seq 映射，供 ReActToolLoop 构造
        // toolResultMsg 时读取（metadata.callSeq），闭环 callSeq 直读（A1③）
        const toolCallSeqMap = new Map<string, number>();
        const toolLoopCtx = {
          session,
          options: options as Record<string, unknown>,
          abortSignal: streamAbortController.signal,
          // P0-4（2026-08-14）：透传工具执行事件回调 → ReActToolLoop.act 触发 → CoreAPIImpl
          // onToolCall 收集（带参数 tool_call chunk + 完成状态提示，与 TAOR 路径行为一致）
          onToolCall: options?.onToolCall,
          executeTool: (tc: ParsedToolCall, opts: unknown) =>
            host.executeTool(
              {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                sessionId: session.id,
              },
              opts as { useErrorHandler?: boolean }
            ),
          pendingInteractions: host.pendingInteractions,
          messageService: host.messageService,
          addAndPersistMessage: (sid: string, msg: Message) =>
            host.addAndPersistMessage(sid, msg),
          checkpointService: host.checkpointService,
          streamingCheckpoint,
          activeClient,
          unifiedTracker: host.unifiedTracker,
          recordChatResponseUsage: (
            sid: string,
            usage: Record<string, number>
          ) => host.recordChatResponseUsage(sid, usage),
          onToolUsage: (usage: Record<string, unknown>) => {
            const u = toUsageInfo(usage);
            if (u && options?.onUsage) options.onUsage(u);
          },
          toolResultRegistry,
          toolRegistry: host.getToolRegistry(),
          toolDefinitions,
          loopDetector: host.loopDetector,
          buildToolRoundMessages: (
            msgs: Record<string, unknown>[],
            am: Message,
            tcs: ParsedToolCall[],
            prs: Array<{
              normalizedToolCall: ParsedToolCall;
              result: ToolResult;
            }>
          ) => host.buildToolRoundMessages(msgs, am, tcs, prs),
          // M1 事件溯源（2026-08-23）：桥接 host 事件写入 → ReActToolLoop 工具轮
          // text/thinking chunk 补写 assistant/text、assistant/thinking 事件
          appendStreamEvent: (
            sid: string,
            ev: Parameters<ChatOrchestratorHost['appendStreamEvent']>[1]
          ) => host.appendStreamEvent(sid, ev),
          getStreamTailSeq: (sid: string) => host.getStreamTailSeq(sid),
          // T2.3（2026-08-23）：tool_call 事件 seq 映射（闭环 callSeq 直读）
          toolCallSeqMap,
          maxToolTurns: host.MAX_TOOL_TURNS,
          estimateMessagesTokens: estimateMessagesTokens as (
            messages: unknown[]
          ) => number,
        } as unknown as import('../ToolLoopRunner.js').ToolLoopContext;

        const { ReActToolLoop } = await import('../ReActToolLoop.js');
        const { reactEventsToChunks } =
          await import('../reactEventsToChunks.js');
        const loop = new ReActToolLoop(
          toolLoopCtx,
          {
            apiMessages,
            currentToolCalls,
            assistantMessage,
          },
          { maxIterations: host.MAX_TOOL_TURNS }
        );

        // M1c：骨架事件流 → ChatStreamChunk（转换层）+ 心跳聚合 + todo chunk
        let heartbeatAt = 0;
        for await (const event of loop.run({
          apiMessages,
          currentToolCalls,
          assistantMessage,
        })) {
          // T1.2 诊断（2026-08-23，[DUP: 前缀）：记录工具事件产出，观察同 callId 是否重复。
          // 根因背景：SSE 层 tool_start/tool_end 序列被重复发送（前端收到 2 遍），
          // 但 events 层（appendStreamEvent）唯一——两条路径独立，此处日志定位产出侧。
          if (event.type === 'tool_start' || event.type === 'tool_end') {
            logger.debug('[DUP:streamFlow] 工具事件产出', {
              sessionId: session.id,
              eventType: event.type,
              callId: (event as { callId: string }).callId,
              ts: Date.now(),
            });
          }
          for (const chunk of reactEventsToChunks(event, session.id)) {
            yield chunk;
          }
          // P0-fix-4（2026-08-23）：工具循环内实时写入 assistant/tool_call 事件。
          // 时机关键：若等到 _finalizeStreamMessage 落盘时才写，tool_call 事件会晚于
          // tool/result（工具循环内 addAndPersistMessage 已写）和 turn/end，导致：
          //   events.jsonl 顺序 = turn/start → text → tool/result → turn/end → assistant/tool_call
          //   （tool_call 无 turn 包裹，回放时工具调用与结果错位）
          // 在 tool_start 事件到达时立即写 assistant/tool_call，保证：
          //   turn/start → text/thinking → assistant/tool_call → tool/result → turn/end
          // 与 _finalizeStreamMessage 落盘时 convertMessage 生成的事件按 id 去重（不会重复写）。
          if (event.type === 'tool_start') {
            try {
              const ts = await host.getStreamTailSeq(session.id);
              const tArgs =
                (event as { input?: Record<string, unknown> }).input ?? {};
              const tCallId = (event as { callId: string }).callId;
              // tool_call 事件自带 messageId + callSeq（A1）；_toolCallSeqMap 由
              // ChatManager.appendStreamEvent 同步维护（toolCallId → event.seq），可重建
              await host.appendStreamEvent(session.id, {
                type: 'assistant/tool_call',
                schemaVersion: 1,
                seq: ts + 1,
                time: Date.now(),
                sessionId: session.id,
                data: {
                  toolCallId: tCallId,
                  name: (event as { name: string }).name,
                  args: tArgs,
                  messageId: assistantMessageId,
                  callSeq: ts + 1,
                },
              });
              // T2.3（2026-08-23）：记录 tool_call 事件 seq，供 ReActToolLoop 构造
              // toolResultMsg 时写入 metadata.callSeq（convertMessage 直读，闭环 A1③）
              toolCallSeqMap.set(tCallId, ts + 1);
            } catch {
              // @ignore-catch — 事件追加失败不阻断工具循环（CS03）
            }
          }
          // todo chunk：工具结果含 _todoData 时产出（对齐旧类 _executeToolRound）
          for (const todoData of loop.getPendingTodos()) {
            yield {
              type: 'todo',
              content: JSON.stringify(todoData),
              sessionId: session.id,
              todoData,
            } as ChatStreamChunk;
          }
          // 心跳：tool_end 后每 5s 产出 execution_phase（对齐旧类 _heartbeat）
          if (event.type === 'tool_end') {
            const now = Date.now();
            if (now - heartbeatAt >= 5000) {
              heartbeatAt = now;
              const hb = loop.getHeartbeatData();
              // 5. steps 截断：仅保留最近 MAX_HEARTBEAT_STEPS 条，避免长任务心跳体积线性增长
              //   （对齐旧类 ToolLoopRunner._buildExecutionSteps；totalSteps 保留真实计数）
              const MAX_HEARTBEAT_STEPS = 30;
              const fullSteps = hb.completedToolNames.map((name) => ({
                name,
                status: 'done' as const,
              }));
              const truncated = fullSteps.length > MAX_HEARTBEAT_STEPS;
              const steps = truncated
                ? fullSteps.slice(-MAX_HEARTBEAT_STEPS)
                : fullSteps;
              yield {
                type: 'execution_phase',
                content: '正在执行工具',
                sessionId: session.id,
                executionPhase: {
                  phase: 'implementing' as const,
                  progress: hb.totalCompletedToolCount,
                  description: '正在执行工具调用',
                  steps,
                  totalSteps: fullSteps.length,
                  truncated,
                  currentStep: '',
                },
              } as ChatStreamChunk;
            }
          }
        }
        assistantMessage = loop.getAssistantMessage();
        // 工具循环结束后再次确保标记存在（loop 内部可能创建/替换了新消息对象）
        assistantMessage.metadata = {
          ...(assistantMessage.metadata ?? {}),
          __streamedEventsWritten: true,
        };
        await host
          .endRollbackRound(session.id, ctx.content, firstAssistantContent)
          .catch((err) => {
            logger.warn('回滚轮次结束失败', { error: String(err) });
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'rollback:endRound',
            }).catch(() => {});
          });
        void currentMessages;
        void currentAssistantMsg;
      }
    } catch (toolExecErr) {
      await handleError(toolExecErr, {
        module: 'chat:ChatManager',
        action: 'streamMessage_toolExecution',
        context: { sessionId: session.id },
      });
      const errMsg = getToolExecErrorMessage(toolExecErr);
      accumulatedContent += `\n\n[${errMsg}]`;
    }

    // P0-fix-3（2026-08-23）：工具调用轮次的 turn/end 不在本处写入——
    // assistant 消息的 tool_call 事件由 _finalizeStreamMessage 落盘时才生成，
    // 若在此补写 turn/end，tool_call 事件会落在 turn/end 之后（仍无 turn 包裹）。
    // 统一由 ChatManager._finalizeStreamMessage 在落盘 assistant 消息后补写，
    // 保证 events.jsonl 顺序：turn/start → text/thinking → tool/result → assistant/tool_call → turn/end。
    // BUG-1 修复：此处不再 release 互斥锁。
    // 锁在首轮 acquire 后（mutexHeld）由最外层 finally 统一释放一次。
    // 原实现双重 release（内层 + 外层 finally）非幂等：队列为空时第二次
    // release 会把 locked 清零，导致并发请求穿透"同一会话串行"保证。

    streamSpan.addEvent('streamMessage.toolLoop.done', {
      'toolTurns.completed': host.toolRoundCount,
    });

    // 项1（会话排查 2026-08-13）：发送完成后的后台预压缩——压缩结果写回会话，
    // 下一轮窗口更小（可能 skip/warn 而非触发慢 Tier3），把 Tier3 的等待从
    // "用户发送前"转移到"发送后后台"。fire-and-forget 不阻塞本轮；
    // 长度守卫（compactSessionInBackground 内部）防覆盖压缩期间新增消息。
    // 前端可见性（2026-08-19）：水位接近触发阈值（复用 policy 真实阈值，CS01 不重复定义）
    // 时发射"后台压缩进行中"状态块，提示用户上下文较长已进入后台压缩
    const bgThresholds = autoCompactionPolicy.getThresholds(
      options?.model || ''
    );
    const bgTokens = estimateMessagesTokens(
      session.messages as unknown as ChatMessage[]
    );
    const bgMax = resolveMaxContextTokens(options?.model);
    const bgRatio = bgMax > 0 ? bgTokens / bgMax : 0;
    if (bgRatio >= bgThresholds.warnRatio) {
      yield {
        type: 'status',
        statusType: 'compaction',
        phase: 'compacting',
        content: `上下文较长（${Math.round(bgRatio * 100)}%），正在后台压缩历史...`,
        sessionId: session.id,
      } as ChatStreamChunk;
    }
    void compactionOrchestrator
      .compactSessionInBackground(
        () => session.messages as unknown as ChatMessage[],
        (messages) => {
          session.messages = messages as unknown as typeof session.messages;
        },
        { model: options?.model || '', sessionId: session.id }
      )
      .catch((err) =>
        logger.warn('compaction:bg_failed', {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        })
      );

    // P2-3.5: 资源清理 + 持久化 + 构建返回消息
    return await _finalizeStreamMessage(
      session,
      ctx.content,
      accumulatedContent,
      assistantMessage,
      finalResponse,
      streamAbortController,
      streamSpan,
      options
    );
  } finally {
    // P2 修复（AB-2）+ BUG-1/2 收敛：兜底释放会话互斥锁。
    // 仅当首轮 acquire 成功（mutexHeld）才释放——acquire 超时抛错时
    // mutexHeld=false，此时绝不能 release（会错误清零他人持有的锁）。
    // 内层工具循环已不再 release（见上），此处是唯一释放点，保证释放恰好一次。
    if (mutexHeld) {
      mutex.release();
    }
    // P2（08-09）：兜底检查点
    savePlainTextCheckpoint({
      checkpoint: plainTextCheckpoint,
      session,
      trigger: 'fallback',
    });

    try {
      getOTelTracing().endSpan(streamSpan);
    } catch {
      /* span 可能已结束 */
    }
  }
}
