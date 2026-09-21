/**
 * SubAgentEngine - 子代理查询循环引擎
 *
 * 对标 CC 源码 runAgent.ts 实现完整的子代理执行生命周期：
 * 1. 调用 LLM 获取响应
 * 2. 解析 tool_use 请求
 * 3. 执行工具并返回结果
 * 4. 重复直到任务完成
 * 5. 支持最大轮次限制和中断
 */

import { randomUUID } from 'crypto';
import type { ChatMessage, ChatResponse, ToolDefinition } from '@modules/ai';
import { DEFAULT_SUBAGENT_MAX_TURNS } from '../../chat/loopTurnLimits.js';
import type { Tool } from '../types/Tool';
import type { ToolUseContext } from '../types/ToolUseContext';
import { ToolExecutionStatus } from '../types/ToolResult';
import type { AIProvider } from '@modules/ai';
import { providerRegistry } from '@modules/ai';
import { resolveModelRoute, RouteKey } from '@modules/ai';
import { ReActLoop } from '@modules/query';
import type {
  ReasonResult,
  ActResult,
  ToolCallEntry,
  ToolResultEntry,
  ReActEvent,
  TerminationReason,
} from '@modules/query';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { withRetry } from '@modules/utils/withRetry';
import { trackUsage } from '@modules/ai';
import { globalEventBus } from '../../core/events/EventBus.js';
import { AgentEventType } from '@modules/agent';

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
const logger = getLogger('tools:AgentTool:SubAgentEngine');

/**
 * 安全发布 EventBus 事件：失败时记录区分事件类型的日志，不阻塞主流程
 */
function safePublish(event: string, payload: Record<string, unknown>): void {
  try {
    globalEventBus.publish(event as any, payload);
  } catch (err) {
    handleError(err, {
      module: 'tools:AgentTool:SubAgentEngine',
      action: 'safePublish',
    });
    logger.warn('EventBus publish failed', {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 子代理进度事件类型
 */
export interface SubAgentProgressEvent {
  /** 子代理 ID */
  agentId: string;
  /** 事件类型 */
  type:
    | 'thinking'
    | 'tool_use'
    | 'tool_result'
    | 'progress'
    | 'complete'
    | 'error';
  /** 事件消息 */
  message: string;
  /** 工具调用 ID（工具调用时） */
  toolUseId?: string;
  /** 工具名称（工具调用时） */
  toolName?: string;
  /** 当前轮次 */
  turn?: number;
  /** 总轮次限制 */
  maxTurns?: number;
}

/**
 * 子代理引擎配置
 */
export interface SubAgentEngineConfig {
  /** 默认最大轮次 */
  defaultMaxTurns: number;
  /** 默认模型 */
  defaultModel: string;
  /** 超时时间（毫秒） */
  timeoutMs: number;
}

/**
 * 子代理执行请求
 */
export interface SubAgentRequest {
  /** Agent ID（自动生成可为空） */
  agentId?: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户消息列表 */
  messages: ChatMessage[];
  /** 可用工具定义 */
  tools: ToolDefinition[];
  /** 实际工具实例映射（name -> Tool） */
  toolInstances: Map<string, Tool>;
  /** 最大轮次 */
  maxTurns?: number;
  /** 模型覆盖 */
  model?: string;
  /**
   * 父级工具上下文透传（BUG 5 修复 2026-08-27）：子代理内部工具调用携带
   * 真实 sessionId/权限上下文——原恒传 { messages: [] }，依赖 context.sessionId
   * 的工具行为异常（send_message 的 sender 恒 'main'、权限拦截失准）
   */
  toolContext?: ToolUseContext;
  /**
   * 外部消息源（teammate 体系集成）：执行期间每轮 LLM 调用前拉取，
   * 将投递给该子 agent 的消息注入上下文（如 SendMessageTool 的消息）
   */
  messageSource?: () => ChatMessage[];
  /**
   * 外部取消信号（BUG 15 修复 2026-08-27）：调用方（如 ParallelOrchestrator 的 abortAll，
   * 该文件已随 B-4 删除）传入 AbortSignal，引擎在循环与工具调用间响应取消——
   * 原先调用方自建的 AbortController 无法传入 engine，abortAll() 形同虚设
   */
  signal?: AbortSignal;
}

/**
 * 子代理执行结果
 */
export interface SubAgentResult {
  /** Agent ID */
  agentId: string;
  /** 是否完成 */
  completed: boolean;
  /** 最终输出内容 */
  output: string;
  /** 工具调用总次数 */
  toolCallCount: number;
  /** 实际执行轮次 */
  turnsUsed: number;
  /** Token 使用情况 */
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 错误信息 */
  error?: string;
  /** L4（2026-09-06）：终止语义细分（completed/max_turns/aborted/error/budget_exhausted/loop_detected）——
   *  由 SubAgentLoop 骨架 getTerminationReason() 派生，不再折叠为单一 error 文本 */
  terminationReason?: TerminationReason;
  /**
   * O4：是否因**整体超时**终止（由超时定时器首次触发时置位）。
   *
   * 与 `terminationReason === 'aborted'` 并存而不互相替代：`aborted` 无法区分
   * "用户中止"与"超时"，故超时**单独成字段**，供上层做
   * `ok = 执行成功 ∧ 门禁通过 ∧ 未超时` 的**正向合取**（避免按错误文本做字符串匹配）。
   */
  timedOut?: boolean;
  /** 执行时长（毫秒） */
  durationMs: number;
}

/**
 * 子代理引擎
 *
 * 管理子代理的完整执行生命周期：
 * - 多轮 LLM 查询循环
 * - 工具调用与结果处理
 * - 进度事件通知
 * - 中断与超时控制
 */
export class SubAgentEngine {
  private config: SubAgentEngineConfig;
  private activeAgents: Map<
    string,
    {
      abortController: AbortController;
      startTime: number;
      /**
       * 归属父会话（B1/O1-2）：yield 恢复的"仍应等待"判据需按会话取值——
       * 全局计数会把其他会话的在途子代理算进来，导致本会话等待被永久阻塞。
       */
      sessionId?: string;
    }
  > = new Map();

  /**
   * @param config 引擎配置
   */
  constructor(config?: Partial<SubAgentEngineConfig>) {
    this.config = {
      // 调用方分级上限统一入口（loopTurnLimits，对标 cc_code 2026-09-01）
      defaultMaxTurns: config?.defaultMaxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS,
      defaultModel: config?.defaultModel ?? '',
      timeoutMs: config?.timeoutMs ?? 600000,
    };
  }

  /**
   * 执行子代理任务
   *
   * @param request 子代理执行请求
   * @param onProgress 进度回调
   * @returns 执行结果
   */
  async execute(
    request: SubAgentRequest,
    onProgress?: (event: SubAgentProgressEvent) => void
  ): Promise<SubAgentResult> {
    const agentId =
      request.agentId || `sa-${randomUUID().replace(/-/g, '').substring(0, 8)}`;
    const abortController = new AbortController();
    const startTime = Date.now();

    this.activeAgents.set(agentId, {
      abortController,
      startTime,
      sessionId: request.toolContext?.sessionId,
    });

    // BUG 15 修复（2026-08-27）：接入外部取消信号——调用方（如
    // ParallelOrchestrator 的 abortAll，该文件已随 B-4 删除）通过 request.signal 取消任务时，联动中止
    // 内部 abortController，使循环检测与工具调用中断路径生效
    const externalSignal = request.signal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        abortController.abort();
      } else {
        externalSignal.addEventListener(
          'abort',
          () => abortController.abort(),
          { once: true }
        );
      }
    }

    // P2-13: 注册子代理到事件泵（500ms 轮询 + 2s 心跳）
    let eventPumpStarted = false;
    try {
      const { getSubAgentEventPump } =
        await import('../../subagents/SubAgentEventPump');
      const pump = getSubAgentEventPump();
      pump.register(agentId);
      // A 修复（2026-08-27）：start 幂等（内部先 stop 再启动），去掉私有字段字符串索引 hack
      pump.start();
      eventPumpStarted = true;
    } catch (err) {
      handleError(err, {
        module: 'tools:AgentTool:SubAgentEngine',
        action: 'startEventPump',
      });
    }

    // 整体超时保护：超时后自动 abort，防止子代理永久挂起
    // O4：超时**单独置位**（`terminationReason` 只会是 'aborted'，无法与用户中止区分）
    let timedOut = false;
    const timeoutMs = this.config.timeoutMs;
    const timeoutTimer = setTimeout(() => {
      if (!abortController.signal.aborted) {
        timedOut = true;
        logger.warn('SubAgent 执行超时，自动中止', { agentId, timeoutMs });
        abortController.abort();
      }
    }, timeoutMs);

    const maxTurns = request.maxTurns || this.config.defaultMaxTurns;
    let toolCallCount = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    const otel = getOTelTracing();
    const execSpan = otel.startSpan('subAgent.execute', {
      'agent.id': agentId,
      'max.turns': maxTurns,
      'tools.count': request.tools.length,
    });

    // 发射 Agent 开始执行事件
    safePublish(AgentEventType.EXECUTE_START, {
      agentId,
      turn: 0,
      maxTurns,
      message: `子代理 ${agentId} 开始执行`,
    });

    try {
      const agentModel = await resolveModelRoute(RouteKey.AGENT);
      const llmClient = agentModel
        ? providerRegistry.getByModel(agentModel)
        : undefined;
      if (!llmClient) {
        // N-38（2026-09-20）可诊断性修复：原文案把原因单一归给「任务分工」，但 `agent` 属
        // **chat 类 route** ⇒ `resolveModelRoute` 会**优先走 SmartRouter 档位解析**
        // （`smartRouter.resolve(route)` → Judge/默认 tier → tierResolver），
        // 只有 SmartRouter 关闭时才回退「任务分工」。实测：配置里 `agent` 一直指向
        // llama.cpp（供应商未注册），而真正的失败原因是**档位默认模型**为未注册的
        // `246676332` —— 原文案把排查方向带偏（详见台账 N-38 / N-40）。
        // 故补上**实际解析到的模型名**，让"档位 vs 任务分工"两条链可被区分。
        throw new AppError(
          `SubAgentEngine: 子代理模型未解析到可用供应商（route=agent → 模型 "${agentModel ?? '(空)'}"）。` +
            `注意该 route 优先走 SmartRouter 档位解析，SmartRouter 关闭时才回退「模型管理→任务分工」` +
            `—— 请对照上述模型名检查对应来源（档位配置 / 任务分工）的模型是否已注册供应商。`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const messages: ChatMessage[] = [
        { role: 'system', content: request.systemPrompt },
        ...request.messages,
      ];

      // 1-④（2026-09-01）：复用 ReActLoop 核心循环（SubAgentLoop），替代独立 for 循环
      const loop = new SubAgentLoop({
        engine: this,
        llmClient,
        messages,
        tools: request.tools,
        model: request.model,
        maxTurns,
        abortSignal: abortController.signal,
        toolInstances: request.toolInstances,
        toolContext: request.toolContext,
        onThinkingDelta: (content, turn) => {
          safePublish(AgentEventType.THINKING_DELTA, {
            agentId,
            content,
            turn,
          });
        },
        onToolStart: async (name, id, turn, count) => {
          safePublish(AgentEventType.TOOL_CALL_START, {
            agentId,
            toolName: name,
            toolUseId: id,
            turn,
          });
          // P2-13: 心跳刷新 — 每次工具调用后更新心跳
          if (eventPumpStarted) {
            try {
              const { getSubAgentEventPump } =
                await import('../../subagents/SubAgentEventPump');
              getSubAgentEventPump().heartbeat(agentId, count);
            } catch (err) {
              handleError(err, {
                module: 'tools:AgentTool:SubAgentEngine',
                action: 'heartbeat',
              });
            }
          }
          onProgress?.({
            agentId,
            type: 'tool_use',
            message: `调用工具: ${name}`,
            toolUseId: id,
            toolName: name,
            turn: turn + 1,
            maxTurns,
          });
        },
        onToolResult: (name, id, content, turn) => {
          safePublish(AgentEventType.TOOL_CALL_DELTA, {
            agentId,
            toolName: name,
            toolUseId: id,
            content,
            turn,
          });
          safePublish(AgentEventType.TOOL_CALL_END, {
            agentId,
            toolName: name,
            toolUseId: id,
            status: 'completed',
            turn,
          });
          onProgress?.({
            agentId,
            type: 'tool_result',
            message: `工具 ${name} 执行完成`,
            toolUseId: id,
            toolName: name,
            turn: turn + 1,
            maxTurns,
          });
        },
        onProgressThinking: (turnNum, maxTurnsLimit) => {
          safePublish(AgentEventType.THINKING_START, {
            agentId,
            turn: turnNum - 1,
            message: `子代理第 ${turnNum}/${maxTurnsLimit} 轮思考`,
          });
          safePublish(AgentEventType.THINKING_END, {
            agentId,
            turn: turnNum - 1,
          });
          onProgress?.({
            agentId,
            type: 'thinking',
            message: `子代理执行第 ${turnNum}/${maxTurnsLimit} 轮`,
            turn: turnNum,
            maxTurns: maxTurnsLimit,
          });
        },
        onUsage: (usage) => {
          if (usage) {
            totalPromptTokens += usage.prompt_tokens || 0;
            totalCompletionTokens += usage.completion_tokens || 0;
          }
        },
      });
      const loopResult = await loop.runCollect({
        messageSource: request.messageSource,
      });
      // 同步循环内工具计数到外壳（catch 异常路径的 EXECUTE_ERROR 展示用）
      toolCallCount = loopResult.toolCallCount;

      this.activeAgents.delete(agentId);
      clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTime;

      if (loopResult.completed) {
        onProgress?.({
          agentId,
          type: 'complete',
          message: '子代理任务完成',
        });
        safePublish(AgentEventType.EXECUTE_END, {
          agentId,
          completed: true,
          toolCallCount: loopResult.toolCallCount,
          turnsUsed: loopResult.turnsUsed,
          durationMs,
          // L4：终止语义透传（正常完成 = 'completed'）
          terminationReason: loopResult.terminationReason,
        });
        otel.endSpan(execSpan, SpanStatusCode.OK);
        // P2-13: 子代理完成 — 通知事件泵
        if (eventPumpStarted) {
          try {
            const { getSubAgentEventPump } =
              await import('../../subagents/SubAgentEventPump');
            getSubAgentEventPump().complete(agentId);
            getSubAgentEventPump().unregister(agentId);
          } catch (err) {
            handleError(err, {
              module: 'tools:AgentTool:SubAgentEngine',
              action: 'eventPumpComplete',
            });
          }
        }
        return {
          agentId,
          completed: true,
          output: loopResult.output,
          toolCallCount: loopResult.toolCallCount,
          turnsUsed: loopResult.turnsUsed,
          tokenUsage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
          },
          durationMs,
          terminationReason: loopResult.terminationReason,
          timedOut,
        };
      }

      // 未完成（abort / max turns）——清理事件泵 + 收尾事件
      if (eventPumpStarted) {
        try {
          const { getSubAgentEventPump } =
            await import('../../subagents/SubAgentEventPump');
          getSubAgentEventPump().fail(agentId);
          getSubAgentEventPump().unregister(agentId);
        } catch (err) {
          handleError(err, {
            module: 'tools:AgentTool:SubAgentEngine',
            action: 'eventPumpMaxTurns',
          });
        }
      }
      safePublish(AgentEventType.EXECUTE_END, {
        agentId,
        completed: false,
        toolCallCount: loopResult.toolCallCount,
        turnsUsed: loopResult.turnsUsed,
        durationMs,
        // L4：截断/中止/错误细分透传（不再折叠为单一 error 文本）
        terminationReason: loopResult.terminationReason,
        error: loopResult.error || '子代理执行未完成',
      });
      otel.endSpan(execSpan, SpanStatusCode.ERROR, 'incomplete');
      return this.buildResult(agentId, startTime, {
        completed: false,
        output: loopResult.output || '子代理执行未完成',
        toolCallCount: loopResult.toolCallCount,
        turnsUsed: loopResult.turnsUsed,
        tokenUsage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
        error: loopResult.error || '子代理执行未完成',
        terminationReason: loopResult.terminationReason,
        timedOut,
      });
    } catch (error) {
      clearTimeout(timeoutTimer);
      this.activeAgents.delete(agentId);

      // P2-13: 子代理失败 — 通知事件泵
      if (eventPumpStarted) {
        try {
          const { getSubAgentEventPump } =
            await import('../../subagents/SubAgentEventPump');
          getSubAgentEventPump().fail(agentId);
          getSubAgentEventPump().unregister(agentId);
        } catch (err) {
          handleError(err, {
            module: 'tools:AgentTool:SubAgentEngine',
            action: 'eventPumpFail',
          });
        }
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      handleError(error, {
        module: 'tools:AgentTool:SubAgentEngine',
        action: 'execute',
      });

      otel.recordError(
        execSpan,
        error instanceof Error ? error : new Error(errorMessage)
      );
      otel.endSpan(execSpan, SpanStatusCode.ERROR, errorMessage);

      // 发射执行错误事件
      safePublish(AgentEventType.EXECUTE_ERROR, {
        agentId,
        error: errorMessage,
        toolCallCount,
      });

      onProgress?.({
        agentId,
        type: 'error',
        message: errorMessage,
      });

      return this.buildResult(agentId, startTime, {
        completed: false,
        output: '',
        toolCallCount,
        turnsUsed: 0,
        tokenUsage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
        error: errorMessage,
        // O4：超时导致的异常路径同样要标记（否则上层无法做"未超时"的合取判定）
        timedOut,
      });
    }
  }

  /**
   * 中断子代理执行
   *
   * @param agentId 子代理 ID
   * @returns 是否成功中断
   */
  abort(agentId: string): boolean {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return false;

    agent.abortController.abort();
    this.activeAgents.delete(agentId);
    return true;
  }

  /**
   * 获取所有活跃子代理
   */
  getActiveAgents(): Array<{ agentId: string; elapsedMs: number }> {
    const now = Date.now();
    return Array.from(this.activeAgents.entries()).map(([agentId, agent]) => ({
      agentId,
      elapsedMs: now - agent.startTime,
    }));
  }

  /**
   * 该会话是否仍有活跃子代理 run（B1/O1-2：yield 恢复的唯一"仍应等待"判据）。
   *
   * 判定取自引擎自身的 run 台账（`execute` 入口登记、完成/失败/中断三路注销），
   * 不取工具侧展示用 Map —— 后者含 pending 清理与全表扫描，不构成 run 存续的事实来源。
   */
  hasActiveAgentForSession(sessionId: string): boolean {
    for (const agent of this.activeAgents.values()) {
      if (agent.sessionId === sessionId) return true;
    }
    return false;
  }

  /**
   * 该 run 的**归属会话**（O14-2：控制面所有权原语，仅供授权校验使用）。
   *
   * 引擎侧归属来自 `request.toolContext.sessionId`（`execute` 入口登记）。
   * 用于补上台账覆盖不到的路径 —— 并行批次的 worker 以 `swarm-<id>` 直接跑在引擎上，
   * 不经 `AgentRunLedger.register`，其归属只能由引擎作答。
   */
  ownerSessionId(agentId: string): string | undefined {
    return this.activeAgents.get(agentId)?.sessionId;
  }

  /**
   * 调用 LLM（使用 withRetry 标准重试）
   */
  private async callLLM(
    client: AIProvider,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    model?: string
  ): Promise<ChatResponse> {
    const resolvedModel =
      model ||
      this.config.defaultModel ||
      (await resolveModelRoute(RouteKey.AGENT));

    const otel = getOTelTracing();
    const span = otel.startSpan('subAgent.callLLM', {
      model: resolvedModel,
      'messages.count': messages.length,
      'tools.count': tools.length,
    });

    try {
      const startTime = Date.now();
      const result = await withRetry(
        () =>
          client.chat(messages, {
            tools: tools.length > 0 ? tools : undefined,
            model: resolvedModel,
          }),
        { maxRetries: 2 }
      );
      const latencyMs = Date.now() - startTime;

      // 记录 token 使用到全局追踪系统
      trackUsage(result as unknown as Record<string, unknown>, {
        model: resolvedModel,
        latencyMs,
      });

      otel.endSpan(span, SpanStatusCode.OK);
      return result;
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR, String(e));
      handleError(e, {
        module: 'tools:AgentTool:SubAgentEngine',
        action: 'callLLM',
      });
      throw e;
    }
  }

  /**
   * 执行单个工具调用
   */
  private async executeToolCall(
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    toolInstances: Map<string, Tool>,
    toolContext?: ToolUseContext
  ): Promise<{ ok: boolean; content: string }> {
    const tool = toolInstances.get(toolCall.name);
    if (!tool) {
      return {
        ok: false,
        content: JSON.stringify({
          success: false,
          error: `Tool '${toolCall.name}' not found`,
        }),
      };
    }

    try {
      const parsedArgs =
        typeof toolCall.arguments === 'string'
          ? JSON.parse(toolCall.arguments)
          : (toolCall.arguments as Record<string, unknown>);
      // BUG 5 修复（2026-08-27）：透传真实工具上下文（原伪造 { messages: [] }）
      // N5 补充（2026-08-27）：调用方未传 toolContext（如 ParallelOrchestrator，该文件已随 B-4 删除）时
      // 显式告警暴露，避免静默伪造导致依赖 sessionId 的工具行为失真
      const resolvedContext = toolContext ?? ({} as unknown as ToolUseContext);
      if (!toolContext) {
        logger.warn(
          'executeToolCall 缺少工具上下文（toolContext），使用空上下文',
          {
            toolName: toolCall.name,
          }
        );
      }
      const result = await tool.execute(parsedArgs, resolvedContext);
      const output = result.output || result.result || JSON.stringify(result);

      if (typeof output === 'string') return { ok: true, content: output };

      return { ok: true, content: JSON.stringify(output) };
    } catch (error) {
      handleError(error, {
        module: 'tools:AgentTool:SubAgentEngine',
        action: 'executeToolCall',
      });
      return {
        ok: false,
        content: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      };
    }
  }

  /**
   * 构建执行结果
   */
  private buildResult(
    agentId: string,
    startTime: number,
    partial: {
      completed: boolean;
      output: string;
      toolCallCount: number;
      turnsUsed: number;
      tokenUsage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
      error?: string;
      terminationReason?: TerminationReason;
      /** O4：是否整体超时终止 */
      timedOut?: boolean;
    }
  ): SubAgentResult {
    return {
      agentId,
      ...partial,
      durationMs: Date.now() - startTime,
    };
  }
}

/** SubAgentLoop 输入：外部消息源（teammate 投递，每轮 reason 前拉取） */
interface SubAgentLoopInput {
  messageSource?: () => ChatMessage[];
}

/** SubAgentLoop 结果（循环层；agentId/durationMs/tokenUsage 由 SubAgentEngine 外壳补全） */
interface SubAgentLoopResult {
  completed: boolean;
  output: string;
  toolCallCount: number;
  turnsUsed: number;
  error?: string;
  /** L4（2026-09-06）：终止语义细分（骨架 getTerminationReason 派生） */
  terminationReason?: TerminationReason;
}

/**
 * 子代理循环（1-④ 2026-09-01：复用 ReActLoop 核心循环，对标 deepseek 子代理复用 ReactLoopAgent）
 *
 * reason = LLM 调用 + 思考事件 + 外部消息注入 + assistant 消息回填；
 * act = 工具执行 + tool 结果回填。
 * SubAgentEngine 作为执行器外壳（abort/事件泵/otel/超时/进度/usage），循环体由本类承载，
 * 消灭第三套独立 for 循环实现（对齐决策 6：复用核心循环）。
 */
class SubAgentLoop extends ReActLoop<
  SubAgentLoopInput,
  unknown,
  SubAgentLoopResult
> {
  private toolCallCount = 0;

  constructor(
    private opts: {
      engine: SubAgentEngine;
      llmClient: AIProvider;
      messages: ChatMessage[];
      tools: ToolDefinition[];
      model?: string;
      maxTurns: number;
      abortSignal?: AbortSignal;
      toolInstances: Map<string, Tool>;
      toolContext?: ToolUseContext;
      onThinkingDelta?: (content: string, turn: number) => void;
      onToolStart?: (
        name: string,
        id: string,
        turn: number,
        toolCallCount: number
      ) => void;
      onToolResult?: (
        name: string,
        id: string,
        content: string,
        turn: number
      ) => void;
      onProgressThinking?: (turn: number, maxTurns: number) => void;
      onProgressTool?: (name: string, turn: number, maxTurns: number) => void;
      onUsage?: (usage: ChatResponse['usage']) => void;
    }
  ) {
    super({
      maxIterations: opts.maxTurns,
      maxConsecutiveInvalidTurns: 0,
      abortSignal: opts.abortSignal,
    });
  }

  protected async *reason(
    input: SubAgentLoopInput
  ): AsyncGenerator<ReActEvent, ReasonResult<unknown>> {
    // 外部消息注入（teammate 体系：每轮 LLM 调用前拉取投递消息）
    const incoming = input.messageSource?.() ?? [];
    if (incoming.length > 0) {
      this.opts.messages.push(...incoming);
      this.opts.onThinkingDelta?.(
        `[收到 ${incoming.length} 条外部消息]`,
        this.state.iteration
      );
    }
    this.opts.onProgressThinking?.(
      this.state.iteration + 1,
      this.config.maxIterations
    );

    const response = await this.opts.engine['callLLM'](
      this.opts.llmClient,
      this.opts.messages,
      this.opts.tools,
      this.opts.model
    );
    this.opts.onUsage?.(response.usage);
    if (response.content) {
      this.opts.onThinkingDelta?.(response.content, this.state.iteration);
    }

    const toolCalls: ToolCallEntry[] = (response.tool_calls ?? []).map(
      (tc) => ({
        id: tc.id,
        name: tc.name,
        input: tc.arguments ?? {},
      })
    );
    // assistant 消息回填（含 tool_calls，act 的 tool 结果紧随其后）
    this.opts.messages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.input) },
      })),
    });
    return {
      text: response.content ?? '',
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  protected async *act(
    calls: ToolCallEntry[]
  ): AsyncGenerator<ReActEvent, ActResult> {
    const results: ToolResultEntry[] = [];
    let anyAborted = false;
    for (const tc of calls) {
      // D3（2026-09-17）：中止时补齐——assistant 消息已带全部 tool_calls，未执行的
      // 调用必须回填 tool 结果消息（OpenAI 兼容协议要求 tool_call 与 tool 结果配对，
      // 否则 400 "tool_calls must be followed by tool messages"），并记为 aborted
      if (this.config.abortSignal?.aborted) {
        anyAborted = true;
        results.push({
          toolCallId: tc.id,
          name: tc.name,
          status: 'aborted',
          error: 'Execution aborted before tool run',
        });
        this.opts.messages.push({
          role: 'tool',
          content: JSON.stringify({ success: false, error: '工具执行被中止' }),
          tool_call_id: tc.id,
        });
        continue;
      }
      this.toolCallCount++;
      this.opts.onToolStart?.(
        tc.name,
        tc.id,
        this.state.iteration,
        this.toolCallCount
      );
      // D3（2026-09-17）：executeToolCall 返回结构化结果——工具缺失/执行异常
      // （ok=false）不再被上报为全成功
      const { ok, content } = await this.opts.engine['executeToolCall'](
        {
          id: tc.id,
          name: tc.name,
          arguments: (tc.input ?? {}) as Record<string, unknown>,
        },
        this.opts.toolInstances,
        this.opts.toolContext
      );
      this.opts.messages.push({
        role: 'tool',
        content,
        tool_call_id: tc.id,
      });
      this.opts.onToolResult?.(tc.name, tc.id, content, this.state.iteration);
      results.push({
        toolCallId: tc.id,
        name: tc.name,
        status: ok ? 'success' : 'error',
        output: content,
      });
    }
    return {
      results,
      allSucceeded: results.every((r) => r.status === 'success'),
      anyAborted,
    };
  }

  protected shouldContinue(
    _input: SubAgentLoopInput,
    result: ReasonResult<unknown>
  ): boolean {
    return result.toolCalls.length > 0;
  }

  protected finalize(): SubAgentLoopResult {
    const lastAssistant = [...this.opts.messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    const output =
      typeof lastAssistant?.content === 'string' ? lastAssistant.content : '';
    // L4（2026-09-06）：终止语义单一判别（骨架 getTerminationReason 按 phase/abort/iteration 派生），
    // completed/截断(max_turns)/中止(aborted)/错误(error)不再靠两布尔折叠。
    const terminationReason = this.getTerminationReason();
    return {
      completed: terminationReason === 'completed',
      output,
      toolCallCount: this.toolCallCount,
      turnsUsed: this.state.iteration,
      terminationReason,
      error:
        terminationReason === 'aborted'
          ? 'Execution aborted'
          : terminationReason === 'max_turns'
            ? `Max turns (${this.config.maxIterations}) reached without completion`
            : terminationReason === 'error'
              ? (this.state.lastError ?? 'Execution error')
              : terminationReason === 'budget_exhausted'
                ? 'Token budget exhausted without completion'
                : undefined,
    };
  }
}

/**
 * 创建默认子代理引擎实例
 */
let defaultEngine: SubAgentEngine | null = null;

export function getSubAgentEngine(): SubAgentEngine {
  if (!defaultEngine) {
    defaultEngine = new SubAgentEngine();
  }
  return defaultEngine;
}

export function setSubAgentEngine(engine: SubAgentEngine): void {
  defaultEngine = engine;
}
