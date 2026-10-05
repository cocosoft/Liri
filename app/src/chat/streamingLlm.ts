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

import { createErrorRecoveryManager } from '@modules/query';
import type { ReActEvent, BudgetControllerLike } from '@modules/query';
import type { ChatResponse, ChatMessage } from '@modules/ai';
import { trackUsage, extractModelFromResponse } from '@modules/ai';
import type { Message } from '@modules/session/types/message.js';
import type { ToolLoopContext, ToolLoopInput } from './ToolLoopRunner.js';
import {
  ensureThinkResponseTags,
  stripThinkResponseTags,
  stripOrphanToolTags,
} from './services/MessageContextPipeline';
import {
  StreamingToolCallScrubber,
  StreamingThinkScrubber,
} from '@modules/streaming';
import { repairImageUrls } from './services/ChatHelper';
import { startRequest } from './services/requestBoundary';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('chat:reactToolLoop');

/** LLM 流式/清洗所需的宿主循环状态（最小结构面，避免入参整型 `ReActToolLoopState`） */
export interface StreamingLlmLoopState {
  messages: Record<string, unknown>[];
  assistantMessage: Message | null;
  toolTurnCount: number;
  llmCallCount: number;
}

/** `StreamingLlm` 的宿主依赖（全部 getter/setter：宿主状态在 run 期内可变） */
export interface StreamingLlmDeps {
  getCtx: () => ToolLoopContext;
  getLoopState: () => StreamingLlmLoopState;
  getConfig: () => { budget?: BudgetControllerLike };
  getState: () => { iteration: number };
  getInput: () => ToolLoopInput;
  getBoostNextReasonMaxTokens: () => boolean;
  setBoostNextReasonMaxTokens: (value: boolean) => void;
  getSupersedeNextRoundText: () => boolean;
  setSupersedeNextRoundText: (value: boolean) => void;
  getLastRoundHadThinking: () => boolean;
  setLastRoundHadThinking: (value: boolean) => void;
}

/**
 * LLM 流式调用 / 输出清洗 / 用量上报（C4）。
 *
 * 2026-10-05 纯搬迁自 `chat/ReActToolLoop.ts`（文件规模债拆分 B3，见
 * `.trae/specs/file-size-debt-partition-plan.md` §19.3）——方法体、注释、日志文案逐字保留，
 * 仅将宿主状态改为经 `StreamingLlmDeps` 的 getter/setter 读写。
 */
export class StreamingLlm {
  /** P1-2（2026-08-26）：LLM 调用错误恢复判定（复用 TAOR 的 errorRecovery，CS01） */
  private readonly _llmRecovery = createErrorRecoveryManager();

  /** P1-3（2026-08-23）：当前工具轮 assistant 消息 id——工具轮入口（首次 _streamLlm 前）预分配，
   *  chunk 事件写入与 createAssistantMessage 复用（N4/A3） */
  private _activeToolRoundMessageId = '';

  constructor(private readonly deps: StreamingLlmDeps) {}

  /** 非流式 LLM 调用（对齐旧类 _nonStreamingLlmRound）：tools 透传 + usage 上报 */
  async callLlmNonStreaming(): Promise<ChatResponse> {
    this.deps.getLoopState().llmCallCount++;
    // P1-16（2026-10-05）：请求发出**前**落 `request/start`（一次请求一条），
    // requestId 透传到用量条 ⇒ 工具轮请求区间可闭合。
    const requestId = await this._beginRequest();
    const response = await this.deps
      .getCtx()
      .activeClient.sendMessage(
        this.deps.getLoopState().messages as unknown as ChatMessage[],
        {
          ...this.deps.getCtx().options,
          tools:
            this.deps.getCtx().toolDefinitions.length > 0
              ? this.deps.getCtx().toolDefinitions
              : undefined,
        }
      );
    this._reportUsage(response, requestId);
    // 每轮 LLM 响应后向骨架预算记账（用 provider **真实** prompt_tokens；无预算时 no-op）
    this._chargeStreamBudget(this._usageOf(response));
    return response;
  }

  /** M1 事件溯源（2026-08-23）：工具轮 text/thinking chunk 写 events.jsonl。
   * 对齐 streamMessageFlow 主循环（首轮已实时写）——此前缺失导致工具轮正文/思考
   * 不进事件流，重新打开会话（events 派生）时正文缺失，仅靠 legacy 合并兜底。
   */
  async appendStreamEvent(
    type:
      | 'assistant/text'
      | 'assistant/thinking'
      | 'tool/canceled'
      | 'assistant/question',
    data: unknown
  ): Promise<void> {
    const { appendStreamEvent, getStreamTailSeq } = this.deps.getCtx();
    if (!appendStreamEvent || !getStreamTailSeq) return;
    try {
      const ts = await getStreamTailSeq(this.deps.getCtx().session.id);
      await appendStreamEvent(this.deps.getCtx().session.id, {
        type,
        schemaVersion: 1,
        seq: ts + 1,
        time: Date.now(),
        sessionId: this.deps.getCtx().session.id,
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
   * A 缺口修复（2026-09-02，P3-7f 基准）：工具轮 text chunk 写入——
   * 优先走 ctx.bufferTextChunk 聚合缓冲（随下次 append 自动 flush 为
   * assistant/text-batch，F-2 语义等价），缺失时回退逐 chunk
   * assistant/text（旧行为，兼容其它调用方）。失败不抛错（CS03）。
   */
  private async _writeToolRoundText(
    content: string,
    replace = false
  ): Promise<void> {
    const buffer = this.deps.getCtx().bufferTextChunk;
    if (buffer) {
      // O2-4：**取代语义要求顺序正确** —— 必须先把被取代的正文落定，再写取代标记；
      // 否则回放顺序变成 [取代标记] → [被取代正文] → [新正文]，清空后又被旧正文追加回来。
      if (replace) {
        await this._flushToolRoundText();
        await this.appendStreamEvent('assistant/text', {
          content,
          replace: true,
        });
        return;
      }
      try {
        await buffer(
          this.deps.getCtx().session.id,
          this._activeToolRoundMessageId,
          content
        );
      } catch {
        // @ignore-catch — 缓冲失败不阻断工具循环（CS03）
      }
      return;
    }
    // O2-4：带上"正文取代"标记 ⇒ 回放/轨迹派生与实时流同源（否则刷新后重复段落复发）
    await this.appendStreamEvent(
      'assistant/text',
      replace ? { content, replace: true } : { content }
    );
  }

  /**
   * A 缺口修复：冲刷工具轮正文缓冲（流结束/异常路径调用，防止尾部正文滞留缓冲）
   */
  private async _flushToolRoundText(): Promise<void> {
    const flush = this.deps.getCtx().flushTextBuffer;
    if (!flush) return;
    try {
      await flush(this.deps.getCtx().session.id);
    } catch {
      // @ignore-catch — 冲刷失败不阻断工具循环（CS03）
    }
  }

  /** 工具轮 assistant 消息 id 读取（供宿主 `getCurrentMessageId()` 覆写委派；空串 ⇒ undefined） */
  currentMessageId(): string | undefined {
    return this._activeToolRoundMessageId || undefined;
  }

  /** 工具轮 assistant 消息 id 原始读取（保留空串语义，供宿主 act 落盘复用） */
  activeToolRoundMessageId(): string {
    return this._activeToolRoundMessageId;
  }

  /**
   * 流式 LLM 调用（generator，M4 方案 A）：逐 chunk 增量 yield reasoning_delta / thinking_delta
   * （P0-C 恢复 + thinking 转发），return 携带清洗后的 ChatResponse。
   * @param retried 残缺工具重试标记：maxTokens 加倍（对齐旧类 _streamLlmRound）
   */
  private async *_streamLlm(
    retried = false
  ): AsyncGenerator<ReActEvent, ChatResponse> {
    this.deps.getLoopState().llmCallCount++;
    // P1-3（2026-08-23）：工具轮 assistant 消息 id 预分配——必须在首个 chunk 事件写入前确定，
    // 首次工具轮 loopState.assistantMessage 尚不存在（N4/A3）；已有则复用其 id。
    this._activeToolRoundMessageId =
      this.deps.getLoopState().assistantMessage?.id ||
      `msg-turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const toolRoundBaseMaxTokens =
      (this.deps.getCtx().options?.maxTokens as number | undefined) ?? 4096;
    // 截断续接放大（2026-09-03）：onIncompleteTurn truncated 分支置位后，本轮预算 base×4
    //（封顶 64K），一次性消费掉标记，避免后续轮次持续放大。
    const boostMaxTokens = this.deps.getBoostNextReasonMaxTokens();
    if (boostMaxTokens) this.deps.setBoostNextReasonMaxTokens(false);
    const toolRoundMaxTokens = boostMaxTokens
      ? Math.min(Math.max(toolRoundBaseMaxTokens * 4, 32768), 64000)
      : retried
        ? Math.min(Math.max(toolRoundBaseMaxTokens * 2, 8192), 64000)
        : toolRoundBaseMaxTokens;
    // P1-16（2026-10-05）：**每次**流式请求发出前落 `request/start`（一次请求一条，
    // 非每 chunk）；requestId 透传到本轮用量条 ⇒ 工具轮请求区间可闭合。
    const requestId = await this._beginRequest();
    const gen = this.deps
      .getCtx()
      .activeClient.streamMessage(
        this.deps.getLoopState().messages as unknown as ChatMessage[],
        {
          ...this.deps.getCtx().options,
          maxTokens: toolRoundMaxTokens,
          signal: this.deps.getCtx().abortSignal,
          tools:
            this.deps.getCtx().toolDefinitions.length > 0
              ? this.deps.getCtx().toolDefinitions
              : undefined,
        }
      );
    const textChunks: string[] = [];
    // P13（2026-09-01）：工具轮 LLM 流式 text chunk 过 StreamingThinkScrubber——
    // 模型输出 <think> 内容时此前原样流式输出（仅最终 content 有清洗链），
    // 前端实时看到思考内容泄露到正文。流式逐 chunk 擦除 think/response/XML 标签。
    const thinkScrubber = new StreamingThinkScrubber();
    // KB-EVENT-BATCH（2026-08-29）：工具轮 thinking 事件防抖合并——推理模型
    // thinking chunk 逐条落盘使 events.jsonl 膨胀，会话加载 O(N²) 卡死。
    const THINKING_BATCH_SIZE = 50;
    const THINKING_BATCH_MS = 2000;
    let thinkingAccum: string[] = [];
    let lastThinkingFlushAt = Date.now();
    const flushThinkingEvents = async () => {
      if (thinkingAccum.length === 0) return;
      const joined = thinkingAccum.join('');
      thinkingAccum = [];
      lastThinkingFlushAt = Date.now();
      try {
        await this.appendStreamEvent('assistant/thinking', {
          content: joined,
        });
      } catch {
        // @ignore-catch — 事件追加失败不阻断流式（CS03）
      }
    };
    let next = await gen.next();
    // O2-4：本轮流式正文的"取代"标记（一次性，只挂在**首个**正文 delta 上）——
    // 两个来源：① 回捞重试轮（`_supersedeNextRoundText`）；② 本轮内对 LLM 的再次调用
    //（残缺工具调用重试 ⇒ `retried=true`，其文本取代本类前一次调用已下发的正文）。
    let pendingReplace = this.deps.getSupersedeNextRoundText() || retried;
    this.deps.setSupersedeNextRoundText(false);
    while (!next.done) {
      const chunk = next.value;
      if (typeof chunk === 'string') {
        // P13（2026-09-01）：流式擦除 think/response/XML 标签——此前原样输出，
        // 前端实时看到 <think> 思考内容泄露到正文（仅最终 content 有清洗链）。
        const scrubbed = thinkScrubber.scrub({
          content: chunk,
          isComplete: false,
        }).content;
        if (scrubbed) {
          textChunks.push(scrubbed);
          const replace = pendingReplace;
          pendingReplace = false;
          // 增量文本即时输出（对齐旧类 P0-C：工具轮 LLM 文本逐 chunk SSE）
          yield {
            type: 'reasoning_delta',
            text: scrubbed,
            messageId: this._activeToolRoundMessageId,
            // O2-4：首 delta 携带"取代"标记 ⇒ 前端清空本消息已累积正文后重建（与落盘同源）
            ...(replace ? { replace: true } : {}),
          };
          // M1 事件溯源：工具轮 text chunk 补写事件（A 缺口修复：优先聚合缓冲 →
          // flush 为 assistant/text-batch，消除逐 chunk 写放大；缺失能力时回退
          // 逐 chunk assistant/text，兼容其它调用方）
          // O2-4：取代标记同步落事件（回放/轨迹视图与实时流同源）
          await this._writeToolRoundText(scrubbed, replace);
        }
      } else if (chunk?.type === 'thinking') {
        // 本轮产出 thinking 标记（reasoning-only 检测用，对标 openclaw 2026-09-01）
        this.deps.setLastRoundHadThinking(true);
        yield {
          type: 'thinking_delta',
          content: chunk.content,
          messageId: this._activeToolRoundMessageId,
        };
        // KB-EVENT-BATCH：thinking 防抖合并落盘
        const thinkingContent =
          typeof chunk.content === 'string'
            ? chunk.content
            : JSON.stringify(chunk.content);
        thinkingAccum.push(thinkingContent);
        if (
          thinkingAccum.length >= THINKING_BATCH_SIZE ||
          Date.now() - lastThinkingFlushAt >= THINKING_BATCH_MS
        ) {
          await flushThinkingEvents();
        }
      }
      try {
        next = await gen.next();
      } catch (err) {
        // KB-EVENT-BATCH-FLUSH（2026-08-29）：流中断/异常时 flush thinking 防抖缓冲，
        // 避免最后一批 thinking 丢失（原异常路径直接跳过 flush），再传播异常。
        await this._flushToolRoundText().catch(() => {});
        await flushThinkingEvents().catch(() => {});
        throw err;
      }
    }
    // 流结束：先 flush 工具轮正文缓冲（A 缺口修复，防尾部正文滞留），
    // 再 flush 剩余 thinking 增量（KB-EVENT-BATCH）
    await this._flushToolRoundText();
    await flushThinkingEvents();
    // P13：flush 未闭合的 think 标签残留（不应输出到正文）
    const thinkResidual = thinkScrubber.flush();
    if (thinkResidual) textChunks.push(thinkResidual);
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
    const onStream = this.deps.getCtx().options?.onStream as
      | ((content: string) => void)
      | undefined;
    onStream?.(cleanContent);

    this._reportUsage(final, requestId);
    // 每轮 LLM 响应后向骨架预算记账（用 provider **真实** prompt_tokens；无预算时 no-op）
    this._chargeStreamBudget(this._usageOf(final));

    return {
      ...final,
      content: cleanContent,
    };
  }

  /** 转发流式 LLM 的增量事件，收集 return 值（供 reason generator 使用） */
  async *consumeStreamingLlm(
    retried: boolean
  ): AsyncGenerator<ReActEvent, ChatResponse> {
    try {
      const iter = this._streamLlm(retried);
      let r = await iter.next();
      while (!r.done) {
        yield r.value;
        r = await iter.next();
      }
      return r.value;
    } catch (error) {
      // P1-2（2026-08-26）：LLM 流中断兜底——复用 TAOR errorRecovery 判定，
      // 网络/服务端/限流/超时等瞬态错误重试一次（走非流式，避免流式事件重复）；
      // abort 类（上下文溢出等需上层降级）才抛出。
      const e = error instanceof Error ? error : new Error(String(error));
      const recovery = this._llmRecovery.assess(e, {
        turnCount: this.deps.getLoopState().toolTurnCount,
        tokenUsage: 0,
      });
      if (recovery.action !== 'abort') {
        logger.warn('reactToolLoop:llm_interrupt_retry', {
          sessionId: this.deps.getCtx().session.id,
          error: e.message.slice(0, 200),
          action: recovery.action,
          turnCount: this.deps.getLoopState().toolTurnCount,
        });
        // 非流式重试一次：优先保证 agent 循环继续（长程任务无人值守前提）
        return await this.callLlmNonStreaming();
      }
      throw error;
    }
  }

  /** P1-16（2026-10-05）：工具轮每次 LLM 请求发出前落 `request/start`（一次请求一条），返回其
   *  seq 作 requestId。复用 `requestBoundary` 唯一实现；`appendStreamEvent` 缺失 ⇒ undefined。 */
  private async _beginRequest(): Promise<number | undefined> {
    const ctx = this.deps.getCtx();
    const append = ctx.appendStreamEvent;
    if (!append) return undefined;
    const model = ctx.options?.model;
    return startRequest((sid, ev) => append(sid, ev), ctx.session.id, {
      model: typeof model === 'string' ? model : undefined,
      reason: 'chat',
    });
  }

  /** usage 上报（对齐旧类：recordChatResponseUsage + onToolUsage + trackUsage） */
  private _reportUsage(response: ChatResponse, requestId?: number): void {
    const usage = this._usageOf(response);
    // 成本 0/0 修复（2026-08-14 复检 #5）：provider 流式返回的 usage 缺失（undefined）
    // 时跳过空记录——原实现无条件 trackUsage，产生 "LLM call recorded: 0/0 tokens"
    // + warn"成本累加" 空条，污染 LLMTracker 与成本统计。有 usage 时经
    // recordChatResponseUsage → `metric/timing` 事件（D1：校准的唯一数据源）驱动校准，
    // 此处空记录不丢真实数据。
    if (
      !usage ||
      (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) === 0
    ) {
      return;
    }
    this.deps
      .getCtx()
      .recordChatResponseUsage(this.deps.getCtx().session.id, usage, requestId);
    this.deps.getCtx().onToolUsage?.((usage as Record<string, unknown>) ?? {});
    trackUsage(response as unknown as Record<string, unknown>, {
      // 2026-09-27 修 `LLM call recorded: unknown`：服务端自发轮次（系统续跑 / 自唤醒 /
      // 目标空闲续接 / PDCA）**不带 `options.model`**，原写法 `options?.model || 'unknown'`
      // 恒为 'unknown' ⇒ 归因丢失，且 `getModelPricing('unknown')` 回落**兜底价**
      // （$3/M in、$15/M out）⇒ **金额也失真**（真机两次记录与兜底价公式精确相等）。
      // 改用既有助手取 **provider 回显的真实模型名**（`ChatResponse.model`），
      // 回落顺序：response.model → options.model → 'unknown'（复用 `extractModelFromResponse`，
      // 与 `SessionSummarizer` 同源，不新增实现）。
      model: extractModelFromResponse(
        response,
        (this.deps.getCtx().options?.model as string | undefined) || 'unknown'
      ),
      providerId: this.deps.getCtx().activeClient.getProviderId(),
      latencyMs: 0,
      isStreaming: !this.deps.getInput().nonStreaming,
      sessionId: this.deps.getCtx().session.id,
    }).catch(() => {});
  }

  /**
   * 每轮 LLM 响应后向骨架预算记账。
   *
   * ⚠️ 2026-09-26 **根因修复（量纲）**：原实现记账
   * `this.ctx.estimateMessagesTokens(this.loopState.messages)` —— 同一份运行日志实测该值与
   * provider 真实用量相差 **6.4 倍**（真实 `prompt_tokens` 29,143 vs 记账 185,195/200,000 = 93%），
   * 且它在真实会话里**单调不降**（0→…→185,195，压缩期间零回落）⇒ 对称记账的"退款"分支永不触发
   * ⇒ 长任务在第 **114/190** 轮被**误杀**（本地 2026-09-26 23:06；证据见 `dev_docs/error_repairs`）。
   *
   * 现改为直接采用 **provider 返回的真实 `prompt_tokens`**（= 本轮请求的真实输入量，即
   * "当前上下文占用"的 ground truth）—— 不引入任何估算，也就不存在两套口径打架的问题。
   * 真实用量缺失（少数 provider 不返回 usage）时**不记账**（fail-open）：用已知高估 6× 的估算值
   * 记账会复现误杀；宁可少一道兜底也不误杀（其余护栏仍在：压缩管线 / maxIterations / 循环检测）。
   *
   * 仅当 config.budget 为工厂注入的可记账预算（含 chargeContextEstimate）时生效；
   * 显式传入的普通 BudgetControllerLike 不记账（由外部负责耗尽判定）。
   */
  private _chargeStreamBudget(usage?: ChatResponse['usage']): void {
    const budget = this.deps.getConfig().budget as
      | (BudgetControllerLike & {
          chargeContextEstimate?: (estimatedTokens: number) => void;
        })
      | undefined;
    if (!budget?.chargeContextEstimate) return;

    const real = usage?.prompt_tokens;
    if (typeof real === 'number' && Number.isFinite(real) && real > 0) {
      budget.chargeContextEstimate(real);
      return;
    }
    logger.debug('reactToolLoop:budget_charge_skipped_no_usage', {
      sessionId: this.deps.getCtx().session.id,
      iteration: this.deps.getState().iteration,
    });
  }

  /** 提取响应 usage（与 `_reportUsage` 同源口径，避免两处各自写 `as` 断言） */
  private _usageOf(response: ChatResponse): ChatResponse['usage'] | undefined {
    return (response as unknown as { usage?: ChatResponse['usage'] }).usage;
  }
}
