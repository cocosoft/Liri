/**
 * ReActLoop — 统一 ReAct (Reasoning-Acting) 循环抽象骨架
 *
 * P1-16: 将 ChatManager.streamMessage()、TAORLoop、LongRunningTaskOrchestrator
 * 三个独立的循环实现抽象为统一骨架，后续所有优化（级联中止/JSON自纠正/max_output）
 * 只需在此骨架中实现一次。
 *
 * 对标：PilotDeck AgentLoop.ts、cc_code QueryEngine、hermes-agent run_agent.py
 *
 * 使用方式：
 *   class MyLoop extends ReActLoop<MyInput, MyContext, MyResult> {
 *     protected async reason(input, ctx): Promise<ReasonResult> { ... }
 *     protected async act(calls, ctx): Promise<ActResult> { ... }
 *     protected shouldContinue(state): boolean { ... }
 *     protected finalize(state): MyResult { ... }
 *   }
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('query:reactLoop');

// ==========================================
// Core Types
// ==========================================

/** 循环状态 */
export interface ReActState {
  iteration: number;
  phase: 'reasoning' | 'acting' | 'completed' | 'aborted' | 'error';
  pendingToolCalls: ToolCallEntry[];
  lastError?: string;
}

/** 工具调用条目 */
export interface ToolCallEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 推理阶段结果 */
export interface ReasonResult<TContext = unknown> {
  text: string;
  toolCalls: ToolCallEntry[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { inputTokens: number; outputTokens: number };
  context?: TContext;
}

/** 执行阶段结果 */
export interface ActResult {
  results: ToolResultEntry[];
  allSucceeded: boolean;
  anyAborted: boolean;
}

/** 工具结果条目 */
export interface ToolResultEntry {
  toolCallId: string;
  name: string;
  status: 'success' | 'error' | 'aborted' | 'timeout';
  output?: string;
  error?: string;
}

/** ReAct 事件流 */
export type ReActEvent =
  | { type: 'reasoning_start' }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'phase'; phase: string; round: number; description?: string }
  | { type: 'reasoning_end'; result: ReasonResult }
  | { type: 'acting_start'; toolCount: number }
  | { type: 'tool_start'; callId: string; name: string }
  | { type: 'tool_progress'; callId: string; progress: number }
  | { type: 'tool_end'; callId: string; result: ToolResultEntry }
  | { type: 'acting_end'; result: ActResult }
  | { type: 'iteration_end'; iteration: number }
  | { type: 'error'; message: string }
  | { type: 'aborted' };

/** 循环配置 */
export interface ReActLoopConfig {
  maxIterations: number;
  abortSignal?: AbortSignal;
  /** 最大连续 all-invalid 轮数（熔断器），0=禁用 */
  maxConsecutiveInvalidTurns: number;
}

const DEFAULT_CONFIG: ReActLoopConfig = {
  maxIterations: 30,
  maxConsecutiveInvalidTurns: 3,
};

// ==========================================
// Abstract Base Class
// ==========================================

export abstract class ReActLoop<
  TInput = unknown,
  TContext = unknown,
  TResult = unknown,
> {
  protected config: ReActLoopConfig;
  protected state: ReActState;
  protected consecutiveInvalidTurns = 0;

  constructor(config?: Partial<ReActLoopConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = { iteration: 0, phase: 'reasoning', pendingToolCalls: [] };
  }

  // ==========================================
  // Abstract methods — 子类必须实现
  // ==========================================

  /**
   * 推理阶段（generator）：调用 LLM，即时产出事件（reasoning_delta/thinking_delta/phase），
   * return 值携带文本 + tool_calls。方案 A（M4，2026-08-13）：async → generator 化，
   * 使 reason 内流式 LLM 文本可逐 chunk 增量输出（旧类 P0-C 语义恢复）。
   */
  protected abstract reason(
    input: TInput,
    context?: TContext
  ): AsyncGenerator<ReActEvent, ReasonResult<TContext>>;

  /** 执行阶段：执行工具调用列表，返回各工具结果 */
  protected abstract act(
    calls: ToolCallEntry[],
    context?: TContext
  ): Promise<ActResult>;

  /** 判断循环是否应该继续 */
  protected abstract shouldContinue(
    input: TInput,
    result: ReasonResult<TContext>
  ): boolean;

  /** 最终化结果（循环结束时调用） */
  protected abstract finalize(state: ReActState, context?: TContext): TResult;

  // ==========================================
  // Hooks — 子类可覆写
  // ==========================================

  /** 压缩检查 Hook（每轮 reasoning 前） */
  protected async beforeReasoning(
    _input: TInput,
    _context?: TContext
  ): Promise<void> {
    // default: no-op
  }

  /** 错误恢复 Hook（模型错误时） */
  protected async onReasoningError(
    _error: unknown,
    _input: TInput,
    _context?: TContext
  ): Promise<ReasonResult<TContext> | null> {
    return null; // default: propagate error
  }

  /** 工具执行错误 Hook */
  protected async onToolError(
    _error: unknown,
    _toolCall: ToolCallEntry,
    _context?: TContext
  ): Promise<void> {
    // default: no-op
  }

  // ==========================================
  // Circuit Breaker
  // ==========================================

  private checkCircuitBreaker(result: ActResult): boolean {
    if (this.config.maxConsecutiveInvalidTurns <= 0) return false;
    const allInvalid = result.results.every((r) => r.status === 'error');
    if (allInvalid) {
      this.consecutiveInvalidTurns++;
      if (
        this.consecutiveInvalidTurns >= this.config.maxConsecutiveInvalidTurns
      ) {
        logger.warn('reActLoop:circuit_breaker triggered', {
          consecutiveInvalidTurns: this.consecutiveInvalidTurns,
          maxConsecutiveInvalidTurns: this.config.maxConsecutiveInvalidTurns,
        });
        return true;
      }
    } else {
      this.consecutiveInvalidTurns = 0;
    }
    return false;
  }

  // ==========================================
  // Main Loop (async generator)
  // ==========================================

  async *run(input: TInput): AsyncGenerator<ReActEvent, TResult> {
    let context: TContext | undefined;

    try {
      while (true) {
        // --- Check abort ---
        if (this.config.abortSignal?.aborted) {
          this.state.phase = 'aborted';
          yield { type: 'aborted' };
          return this.finalize(this.state, context);
        }

        // --- Max iterations ---
        if (this.state.iteration >= this.config.maxIterations) {
          logger.info('reActLoop:max_iterations reached', {
            maxIterations: this.config.maxIterations,
            iteration: this.state.iteration,
          });
          this.state.phase = 'completed';
          return this.finalize(this.state, context);
        }

        // --- Compression check (before reasoning) ---
        await this.beforeReasoning(input, context);

        // ==== REASONING PHASE ====
        this.state.phase = 'reasoning';
        yield { type: 'reasoning_start' };

        let reasonResult: ReasonResult<TContext>;
        try {
          // M4（方案 A）：reason 为 generator —— 迭代消费即时事件（增量文本/thinking/phase），
          // 收集 return 值作为 ReasonResult（主循环 await 期间不再吞掉增量输出）。
          const reasonIter = this.reason(input, context);
          let iterResult = await reasonIter.next();
          while (!iterResult.done) {
            yield iterResult.value;
            iterResult = await reasonIter.next();
          }
          reasonResult = iterResult.value;
          context = reasonResult.context ?? context;
          yield { type: 'reasoning_end', result: reasonResult };
        } catch (err) {
          handleError(err, { module: 'query:reactLoop', action: 'reasoning' });
          logger.warn('reActLoop:reasoning_error', { error: String(err) });
          const recovered = await this.onReasoningError(err, input, context);
          if (recovered) {
            reasonResult = recovered;
            context = reasonResult.context ?? context;
            yield { type: 'reasoning_end', result: reasonResult };
          } else {
            this.state.phase = 'error';
            this.state.lastError = String(err);
            yield { type: 'error', message: String(err) };
            return this.finalize(this.state, context);
          }
        }

        // --- No tool calls → done ---
        if (!this.shouldContinue(input, reasonResult)) {
          this.state.phase = 'completed';
          return this.finalize(this.state, context);
        }

        // ==== ACTING PHASE ====
        this.state.phase = 'acting';
        this.state.pendingToolCalls = reasonResult.toolCalls;
        yield {
          type: 'acting_start',
          toolCount: reasonResult.toolCalls.length,
        };

        let actResult: ActResult;
        try {
          // Emit per-tool start events
          for (const tc of reasonResult.toolCalls) {
            yield { type: 'tool_start', callId: tc.id, name: tc.name };
          }
          actResult = await this.act(reasonResult.toolCalls, context);
        } catch (err) {
          handleError(err, { module: 'query:reactLoop', action: 'acting' });
          actResult = {
            results: reasonResult.toolCalls.map((tc) => ({
              toolCallId: tc.id,
              name: tc.name,
              status: 'error' as const,
              error: String(err),
            })),
            allSucceeded: false,
            anyAborted: false,
          };
        }

        // Emit per-tool end events
        for (const r of actResult.results) {
          yield { type: 'tool_end', callId: r.toolCallId, result: r };
        }
        yield { type: 'acting_end', result: actResult };

        // --- Advance iteration ---
        this.state.iteration++;
        this.state.pendingToolCalls = [];

        // --- Circuit breaker ---
        if (this.checkCircuitBreaker(actResult)) {
          this.state.phase = 'error';
          this.state.lastError =
            'circuit_breaker: consecutive invalid turns exceeded';
          yield {
            type: 'error',
            message: this.state.lastError,
          };
          return this.finalize(this.state, context);
        }

        yield { type: 'iteration_end', iteration: this.state.iteration };
      }
    } catch (err) {
      handleError(err, { module: 'query:reactLoop', action: 'run' });
      this.state.phase = 'error';
      this.state.lastError = String(err);
      yield { type: 'error', message: String(err) };
      return this.finalize(this.state, context);
    }
  }

  /** 获取当前状态（用于外部监控） */
  getState(): Readonly<ReActState> {
    return this.state;
  }

  /**
   * 便捷入口（A2）：完整收集事件流并返回最终结果（非流式消费）。
   * 供非流式调用点 / 需 Promise<TResult> 的调用方使用（M4）。
   */
  async runCollect(input: TInput): Promise<TResult> {
    const iter = this.run(input);
    let r = await iter.next();
    while (!r.done) {
      r = await iter.next();
    }
    return r.value;
  }

  /** 中止循环 */
  abort(): void {
    this.state.phase = 'aborted';
    if (this.config.abortSignal) {
      // 通过 AbortController 传播中止信号
      (
        this.config.abortSignal as AbortSignal & {
          _controller?: AbortController;
        }
      )._controller?.abort();
    }
  }
}
