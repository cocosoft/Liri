/**
 * CompactionOrchestrator — 压缩编排器（Phase 5 集成回线）
 *
 * 串联 UnifiedTokenTracker 评估 → MicroCompactionEngine / SnipEngine / LLM Full
 * 注入 CompactionHooks 生命周期 + CompactionMetrics 追踪
 *
 * 管线（C7 收敛 2026-08-30：评估统一走 UnifiedTokenTracker.checkBeforeRequest）：
 *   1. UnifiedTokenTracker.checkBeforeRequest() → skip / warn / trigger
 *   2. skip → 返回原消息
 *   3. warn → 尝试 Tier 1（Micro），无效则 Tier 2（Snip）
 *   4. trigger → 执行 Tier 2（Snip），无效则 Tier 3（LLM Full）
 *   5. 每次压缩前后调用 hookRegistry + compactionMetricsTracker
 */
import type { ChatMessage } from '@modules/ai';
import { estimateMessagesTokens } from '@modules/ai';
import {
  type CompactionDecision,
  type UnifiedTokenTracker,
  evaluateCompactionFallback,
} from '@modules/core/tokenBudget/UnifiedTokenTracker';
import { applyMicroCompaction } from './MicroCompactionEngine';
import { snipMessages } from './SnipEngine';
import {
  ensureTrailingUserMessage,
  collectToolCallIds,
  collectToolResultIds,
  stripUnpairedToolResults,
  stripUnpairedToolCalls,
  // R6（2026-09-21）：请求侧严格配对（Tier3 折叠批 400 的根因修复）
  completeTrailingToolPairs,
  sanitizeToolCallPairs,
} from './toolPairIntegrity';
import { hookRegistry } from '../hooks/CompactionHooks';
import { compactionMetricsTracker } from './CompactionMetrics';
import { compactionLockStore } from './CompactionLockStore';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  enterPhase,
  exitPhase,
} from '@modules/diagnostics/loopProbe/phaseStack';
import type {
  parseCompactionSummary as ParseCompactionSummaryFn,
  renderCompactionSummary as RenderCompactionSummaryFn,
} from './StructuredCompactionPrompt';

const logger = getLogger('context:compaction:orchestrator');

// 缓存动态 import 避免每次 Tier 3 压缩重复解析模块
let cachedAiModule: {
  default: { generate: Function };
  AIMessageRole: Record<string, string>;
} | null = null;

async function getAiService() {
  if (!cachedAiModule) {
    const mod = (await import('@modules/ai')) as {
      default: { generate: Function };
      AIMessageRole: Record<string, string>;
    };
    cachedAiModule = {
      default: mod.default,
      AIMessageRole: mod.AIMessageRole,
    };
  }
  return cachedAiModule;
}

/**
 * Tier 3 LLM 压缩超时上限（毫秒），超时后保留 Tier2 结果并中断 LLM 请求。
 * 超时治理（2026-08-13 根治）：仅约束 Tier3（LLM 调用），Tier1/2 同步毫秒级不受限。
 * 历史日志显示 Tier3 实际耗时 12-21s，30s 对长摘要仍偏紧；60s 是摘要生成
 * （max_tokens=2560，5 字段 ≤1400 字）与用户等待的折中，超时由 signal 真正中断。
 */
const COMPACTION_TIMEOUT_MS = 60_000;

/** R1（2026-09-16）：Tier3 迭代折叠——单批折叠源 token 预算（≤约 5 倍 max_tokens=2560，单次摘要可覆盖） */
const FOLD_BATCH_SOURCE_TOKENS = 12_000;
/** R1：Tier3 单次压缩的批折叠上限（LLM 摘要调用数上限，防极端长上下文失控） */
const FOLD_MAX_ITERATIONS = 20;
/** R1（2026-09-16）：Tier3 折叠目标窗口——剩余上下文低于该 token 即停（与 ReActToolLoop 层窗口同源） */
const FOLD_TARGET_TOKENS =
  Number(process.env.REACT_LAYER_WINDOW_TOKENS) || 45_000;

/**
 * R1（2026-09-16）：从旧→新的待折叠消息流取出**最早的一小批**——累积到接近 budgetTokens 即封批，
 * 单条超大消息不被打散（自成一批，保证折叠批内 tool 配对尽可能完整）。
 * @param pool 待折叠消息（旧→新）
 * @returns 最早一批 batch 与剩余 rest（旧→新）
 */
export function extractEarliestBatch(
  pool: ChatMessage[],
  budgetTokens: number
): { batch: ChatMessage[]; rest: ChatMessage[] } {
  const batch: ChatMessage[] = [];
  let batchTokens = 0;
  for (let i = 0; i < pool.length; i++) {
    const t = estimateMessagesTokens([pool[i]]);
    if (batch.length > 0 && batchTokens + t > budgetTokens) {
      // R6（2026-09-21）：**切点不得落在 tool_call 与其结果之间**。
      // 修复前直接 `return { batch, rest: pool.slice(i) }` ⇒ 批尾可能是带 `tool_calls`
      // 的 assistant 而结果留在 rest ⇒ 折叠请求出现悬空 tool_calls ⇒ 上游 400 ⇒
      // Tier3 全批失败、压缩 `applied:false`（真机连续 13 次）。
      // 此处向前吃齐配对结果（宁可略超预算），保语义完整性。
      const aligned = completeTrailingToolPairs(batch, pool.slice(i));
      return { batch: aligned.batch, rest: aligned.rest };
    }
    batch.push(pool[i]);
    batchTokens += t;
  }
  return { batch, rest: [] };
}

const FULL_COMPACTION_PROMPT = `You are a conversation compressor. Summarize the following conversation to preserve essential context while drastically reducing token count.

Rules:
1. Preserve ALL user personal information, preferences, and decisions
2. Preserve the current task's progress and latest state
3. Merge repetitive exchanges into concise summaries
4. Keep tool call results that are still relevant to the current task
5. Output ONLY the compressed conversation in the same language as the original

Output format: A concise narrative summary of the conversation.`;

export interface CompactionContext {
  sessionId?: string;
  model: string;
  configOverride?: number;
}

/**
 * P1-2（2026-08-27）：摘要调用信封——记录 Tier3 摘要生成的模型调用信息，
 * 使一次摘要请求可从日志/事件重建（对标 dsh compaction/summary 的
 * provider/model/maxTokens/usage + llmStreamCall 标记）。
 */
export interface CompactionSummaryEnvelope {
  /** 摘要调用使用的模型名 */
  model: string;
  /** 生成上限（max_tokens） */
  maxTokens?: number;
  /** 摘要调用的 token 使用（provider 返回） */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** 是否使用了结构化 5 字段摘要（false = 回退纯文本） */
  structured: boolean;
}

export interface CompactionOrchestratorOptions {
  /** C7 收敛：评估统一走 UnifiedTokenTracker（checkBeforeRequest），不再使用 AutoCompactionPolicy */
  tracker?: UnifiedTokenTracker;
  /** R1（2026-09-16）：可选注入 AI 服务，用于端到端测试驱动折叠循环；缺省经 getAiService() 动态 import */
  aiService?: { generate: Function };
}

/** 压缩执行结果（P1-2 扩展：success 时携带摘要调用信封供事件重建） */
export type CompactionOutcome = {
  messages: ChatMessage[];
  applied: boolean;
  summaryEnvelope?: CompactionSummaryEnvelope;
};

export class CompactionOrchestrator {
  /** C7 收敛：评估统一走 UnifiedTokenTracker.checkBeforeRequest（含校准因子/反抖动/消息数兜底） */
  private tracker: UnifiedTokenTracker | null = null;
  /** R1（2026-09-16）：可注入 AI 服务（测试驱动折叠循环），null 时经 getAiService() 动态 import */
  private aiService: { generate: Function } | null = null;

  constructor(options: CompactionOrchestratorOptions = {}) {
    this.tracker = options.tracker ?? null;
    this.aiService = options.aiService ?? null;
  }

  /** 设置评估 tracker（C7 收敛：ChatManager 初始化时注入其 unifiedTracker 实例） */
  setTracker(tracker: UnifiedTokenTracker): void {
    this.tracker = tracker;
  }

  /**
   * 压缩评估统一入口（C7 收敛）：优先 UnifiedTokenTracker.checkBeforeRequest（异步协作式估算
   * + 校准因子 + 反抖动），无 tracker 时回退 evaluateCompactionFallback（纯函数兜底）。
   */
  private async evaluateCompaction(
    messages: ChatMessage[],
    ctx: CompactionContext,
    tracker?: UnifiedTokenTracker
  ): Promise<CompactionDecision> {
    const active = tracker ?? this.tracker;
    if (active) {
      return active.checkBeforeRequest(messages, ctx.model);
    }
    // 无 tracker 异常兜底（正常路径 ChatManager 已注入）：纯函数评估，不参与校准/反抖动
    logger.warn(
      'compaction:evaluate_fallback — 无 UnifiedTokenTracker，使用纯函数兜底评估',
      {
        sessionId: ctx.sessionId,
        model: ctx.model,
      }
    );
    return evaluateCompactionFallback(messages, ctx.model);
  }

  /** 记录反抖动数据（C7 收敛：委托 UnifiedTokenTracker.recordCompaction） */
  private recordSaving(
    savingPercent: number,
    beforeTokens: number,
    afterTokens: number
  ): void {
    if (this.tracker) {
      this.tracker.recordCompaction(beforeTokens, afterTokens);
    } else if (savingPercent >= 10) {
      // 无 tracker 时仅记录日志（反抖动由 Unified 接管，此处无状态可写）
      logger.debug('compaction:no_tracker_saving_skipped', { savingPercent });
    }
  }

  /**
   * 执行压缩编排
   * @param options.skipTier3Sync 异步压缩模式（2026-08-14 补充落地，对应复查
   *   "三处调用点仍同步 await" 的剩余项）：发送路径不阻塞等待 Tier3（LLM 摘要），
   *   仅同步执行 Tier1/2（毫秒级），Tier3 由调用方发送后经 compactSessionInBackground
   *   后台执行写回会话（下一轮生效）。
   * @param options.preEvaluated 调用方已评估的决策（2026-08-19 TRAE 式回合开始预压缩）：
   *   传入时跳过内部二次同步评估——预评估走协作式异步估算（evaluateAsync），避免大历史
   *   同步估算阻塞事件循环。调用方须保证 preEvaluated 与 messages 对应同一份消息。
   * @returns 压缩后的消息，以及是否应用了压缩
   */
  async compact(
    messages: ChatMessage[],
    ctx: CompactionContext,
    options?: {
      skipTier3Sync?: boolean;
      preEvaluated?: CompactionDecision;
      tracker?: UnifiedTokenTracker;
    }
  ): Promise<CompactionOutcome> {
    enterPhase('compaction:orchestrate');
    try {
      // 防止双管线并发压缩同一会话（P2-5：内存 + 磁盘双层锁，崩溃残留锁自动清除）
      let lockCompactionId: string | undefined;
      if (ctx.sessionId) {
        const acquired = compactionLockStore.tryAcquire(ctx.sessionId);
        if (acquired === null) {
          // 并发拒绝是异常路径（同会话已被另一压缩管线占用），提升为 warn 便于排查
          logger.warn(
            'compaction:already_in_progress — 压缩被并发锁拒绝，跳过本次压缩',
            {
              sessionId: ctx.sessionId,
              model: ctx.model,
              messageCount: messages.length,
              estimatedTokens: options?.preEvaluated?.snapshot.tokens,
            }
          );
          return { messages, applied: false };
        }
        lockCompactionId = acquired;
        logger.info('compaction:lock_acquired — 编排器已获取压缩锁', {
          sessionId: ctx.sessionId,
          compactionId: acquired,
          trigger: options?.preEvaluated?.decision ?? 'evaluate',
        });
      }

      try {
        const startTime = Date.now();
        // 排查日志：压缩触发入口——记录触发条件（消息数/估算 tokens/模型/窗口配置），
        // 与后续"决策/完成/未应用"日志串联，便于排查边界情况
        // 传入 preEvaluated 时复用其 snapshot.tokens，避免对巨大历史再次同步估算（阻塞事件循环）
        const entryTokens =
          options?.preEvaluated?.snapshot.tokens ??
          estimateMessagesTokens(messages);
        logger.info('compaction:①触发评估', {
          sessionId: ctx.sessionId,
          model: ctx.model,
          messageCount: messages.length,
          estimatedTokens: entryTokens,
          preEvaluated: !!options?.preEvaluated,
          configOverride: ctx.configOverride,
        });
        // 决策汇总（skip/warn/trigger 三态 + 阈值快照）：
        // 传入 preEvaluated（调用方协作式异步评估）时直接复用，跳过内部二次同步评估
        const decision =
          options?.preEvaluated ??
          (await this.evaluateCompaction(messages, ctx, options?.tracker));
        // 排查日志：决策汇总（skip/warn/trigger 三态 + 阈值快照）
        logger.info('compaction:决策', {
          decision: decision.decision,
          ratio: Number(decision.snapshot.ratio.toFixed(3)),
          tokens: decision.snapshot.tokens,
          maxTokens: decision.snapshot.maxTokens,
          reason: decision.reason ?? null,
          sessionId: ctx.sessionId,
        });

        // Skip：无需压缩
        if (decision.decision === 'skip') {
          logger.debug('compaction:skip', {
            ratio: Number(decision.snapshot.ratio.toFixed(3)),
            reason: decision.reason ?? 'below warning threshold',
          });
          return { messages, applied: false };
        }

        // 超时治理（2026-08-13 根治）：超时保护仅约束 Tier3（LLM 调用），Tier1/2
        // 为同步毫秒级不受限——原实现 Promise.race 对"整个 _doCompact"超时，Tier2
        // 已完成但 Tier3 未完成时整个结果被丢弃（Tier2 成果白费 + 返回未压缩），
        // 且旧代码 signal 未透传导致 Tier3 僵尸请求继续跑。见 _runFullCompactionWithTimeout。
        let result: CompactionOutcome;
        try {
          result = await this._doCompact(
            messages,
            ctx,
            decision,
            startTime,
            options
          );
        } catch (err) {
          // 非超时错误：记录 + 返回 fallback，不抛向上层（上层可能没有 catch）
          await handleError(err, {
            module: 'context:compaction',
            action: 'compact',
          });
          // 排查日志：异常未应用——与 Tier3 超时分支区分，调用方将走截断兜底
          logger.warn('compaction:❌异常未应用（调用方将走截断兜底）', {
            sessionId: ctx.sessionId,
            error: err instanceof Error ? err.message : String(err),
            elapsedMs: Date.now() - startTime,
          });
          return { messages, applied: false };
        }
        // 排查日志：压缩完成（applied + 压缩后 tokens + 耗时）
        logger.info('compaction:②完成', {
          sessionId: ctx.sessionId,
          applied: result.applied,
          beforeTokens: decision.snapshot.tokens,
          afterTokens: estimateMessagesTokens(result.messages),
          elapsedMs: Date.now() - startTime,
        });
        return result;
      } finally {
        if (ctx.sessionId && lockCompactionId) {
          compactionLockStore.release(ctx.sessionId, lockCompactionId);
        }
      }
    } finally {
      exitPhase('compaction:orchestrate');
    }
  }

  /**
   * 消息集内容指纹（P2-6 对标 deepseek-harness assertSelectedSpanStable）：
   * role + content 长度 + 前 64 字符参与 hash，用于后台压缩写回前校验
   * 压缩期间会话消息内容未被并发修改（数量守卫覆盖增删，本指纹覆盖同数量改写）。
   * @param messages 待校验的消息集
   */
  private static fingerprintMessages(messages: ChatMessage[]): string {
    let hash = 5381;
    for (const m of messages) {
      const content = typeof m.content === 'string' ? m.content : '';
      hash = ((hash << 5) + hash + m.role.length) | 0;
      hash = ((hash << 5) + hash + content.length) | 0;
      for (let i = 0; i < content.length && i < 64; i++) {
        hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
      }
    }
    return hash.toString(36);
  }

  /**
   * 后台异步压缩会话消息（项1 落地，会话排查 2026-08-13）：
   * 发送完成后 fire-and-forget 调用，压缩结果写回会话，下一轮发送窗口更小
   * （可能 skip/warn 而非触发慢 Tier3），从而把 Tier3 的等待从"用户发送前"
   * 转移到"发送后后台"。
   * 稳定性守卫（P2-6）：压缩期间会话消息数量或内容变化 → 放弃写回，
   * 避免覆盖并发新增/修改的消息（数量守卫 + 内容指纹双重校验）。
   * @param getMessages 读取当前会话消息（引用实时值）
   * @param setMessages 写回压缩结果
   * @returns 是否已写回
   */
  async compactSessionInBackground(
    getMessages: () => ChatMessage[],
    setMessages: (messages: ChatMessage[]) => void,
    ctx: CompactionContext
  ): Promise<boolean> {
    const snapshotCount = getMessages().length;
    if (snapshotCount === 0) return false;
    // 压缩开始前的内容指纹（压缩期间可能被并发修改）
    const snapshotFingerprint =
      CompactionOrchestrator.fingerprintMessages(getMessages());
    // 排查日志：后台压缩入口（记录触发条件，与 compact() 内部"①触发评估/决策"日志串联）
    logger.info('compaction:bg_start — 后台压缩开始', {
      sessionId: ctx.sessionId,
      model: ctx.model,
      messageCount: snapshotCount,
    });
    const result = await this.compact(getMessages(), ctx);
    if (!result.applied) {
      // 排查日志：压缩未应用（决策 skip 或压缩未降体积）——区分"无需压缩"与"压缩失败"
      logger.debug('compaction:bg_no_effect — 压缩未应用', {
        sessionId: ctx.sessionId,
        messageCount: snapshotCount,
      });
      return false;
    }
    // 守卫①：压缩期间消息数量变化（有新消息/删除）→ 放弃写回（避免覆盖新增）
    if (getMessages().length !== snapshotCount) {
      logger.warn('compaction:bg_skip — 压缩期间消息数量变化，放弃写回', {
        sessionId: ctx.sessionId,
        snapshotCount,
        currentCount: getMessages().length,
      });
      return false;
    }
    // 守卫②（P2-6）：数量相同但内容被并发改写（替换/编辑消息）→ 放弃写回
    if (
      CompactionOrchestrator.fingerprintMessages(getMessages()) !==
      snapshotFingerprint
    ) {
      logger.warn('compaction:bg_skip — 压缩期间消息内容变化，放弃写回', {
        sessionId: ctx.sessionId,
        snapshotCount,
      });
      return false;
    }
    setMessages(result.messages);
    logger.info('compaction:bg_applied — 后台压缩已写回会话', {
      sessionId: ctx.sessionId,
      messageCount: result.messages.length,
      beforeCount: snapshotCount,
    });
    return true;
  }

  /** 执行压缩管线。Tier1/2 为同步毫秒级；Tier3 带独立超时（见 _runFullCompactionWithTimeout） */
  private async _doCompact(
    messages: ChatMessage[],
    ctx: CompactionContext,
    decision: CompactionDecision,
    startTime: number,
    options?: { skipTier3Sync?: boolean }
  ): Promise<CompactionOutcome> {
    const beforeTokens = decision.snapshot.tokens;

    // Run before hooks
    await hookRegistry.runBeforeCompact({
      tier: decision.decision === 'trigger' ? 2 : 1,
      trigger: decision.decision === 'warn' ? 'auto_warn' : 'blocking_trigger',
      messages,
      beforeTokens,
      maxTokens: decision.snapshot.maxTokens,
      sessionId: ctx.sessionId,
    });

    let result: CompactionOutcome;
    let tier: 1 | 2 | 3;
    let triggerLabel: string;

    if (decision.decision === 'warn') {
      // Warn 阶段：尝试 Tier 1 MicroCompaction
      tier = 1;
      triggerLabel = 'warn_micro';
      logger.debug('compaction:trying_tier1', {
        reason: triggerLabel,
        beforeTokens,
      });

      const microResult = applyMicroCompaction({ messages });
      if (microResult.applied) {
        result = { messages: microResult.messages, applied: true };
      } else {
        // Micro 无效果，尝试 Tier 2 Snip
        tier = 2;
        triggerLabel = 'warn_snip';
        logger.debug('compaction:trying_tier2', {
          reason: 'micro_no_effect',
          beforeTokens,
        });

        const snipResult = snipMessages(messages);
        result = { messages: snipResult.messages, applied: snipResult.applied };
      }
    } else {
      // Trigger：直接 Tier 2 Snip
      tier = 2;
      triggerLabel = 'blocking_trigger';
      const snipResult = snipMessages(messages);
      result = { messages: snipResult.messages, applied: snipResult.applied };

      // Tier 2 无效或仍超限 → 尝试 Tier 3 LLM Full Compaction（带独立超时，
      // 超时只中断 LLM 调用并保留 Tier2 结果，不再丢弃整个压缩成果）
      if (
        !result.applied ||
        (await this.isStillOverBudget(result.messages, ctx))
      ) {
        logger.info('compaction:escalating_to_tier3', {
          reason: result.applied ? 'snip_insufficient' : 'snip_no_effect',
          beforeTokens,
        });

        // 异步压缩模式（2026-08-14 补充落地）：发送路径不阻塞等待 LLM 摘要。
        // Tier2 结果立即返回（毫秒级 + C5 截断兜底保证不超窗口），Tier3 由
        // 调用方发送后经 compactSessionInBackground 后台执行写回会话。
        if (options?.skipTier3Sync) {
          logger.info(
            'compaction:async — 发送路径跳过同步 Tier3（后台执行写回）',
            {
              sessionId: ctx.sessionId,
              tier2Applied: result.applied,
            }
          );
        } else {
          const fullResult = await this._runFullCompactionWithTimeout(
            result.messages,
            ctx
          );
          if (fullResult.applied) {
            tier = 3;
            triggerLabel = 'full_compaction';
            result = fullResult;
          }
        }
      }
    }

    if (!result.applied) {
      logger.warn('compaction:no_effect', {
        tier,
        trigger: triggerLabel,
        beforeTokens,
      });
      return { messages, applied: false };
    }

    // 计算节省
    const afterTokens = estimateMessagesTokens(result.messages);
    const savingPercent =
      beforeTokens > 0
        ? ((beforeTokens - afterTokens) / beforeTokens) * 100
        : 0;
    const durationMs = Date.now() - startTime;

    // 记录反抖动数据（Tier 2 及以上）——C7 收敛：委托 UnifiedTokenTracker.recordCompaction
    if (tier >= 2) {
      this.recordSaving(savingPercent, beforeTokens, afterTokens);
    }

    // Run tier trigger hook
    await hookRegistry.runTierTrigger(tier, triggerLabel, beforeTokens);

    // Run after hooks
    await hookRegistry.runAfterCompact({
      tier,
      afterTokens,
      savingPercent,
      durationMs,
    });

    // 记录指标
    compactionMetricsTracker.record({
      timestamp: new Date().toISOString(),
      tier,
      trigger: triggerLabel,
      beforeTokens,
      afterTokens,
      savingPercent,
      durationMs,
      sessionId: ctx.sessionId,
      decisions: [
        decision.reason ?? `ratio=${decision.snapshot.ratio.toFixed(2)}`,
      ],
    });

    logger.info('compaction:applied', {
      tier,
      trigger: triggerLabel,
      beforeTokens,
      afterTokens,
      savingPercent: Number(savingPercent.toFixed(1)),
      durationMs,
    });

    return result;
  }

  /**
   * Tier 3 LLM 压缩 + 独立超时（2026-08-13 根治超时问题）：
   * 超时只中断 LLM 调用（signal 经 aiService/OpenAIProvider 透传真正 abort，消灭僵尸请求），
   * 超时返回 applied:false → 调用方保留 Tier2 结果（不再丢弃已完成压缩成果）。
   * 与旧实现"Promise.race 整体超时丢弃整个 _doCompact"的区别：Tier1/2 同步毫秒级不受限。
   */
  private async _runFullCompactionWithTimeout(
    messages: ChatMessage[],
    ctx: CompactionContext
  ): Promise<CompactionOutcome> {
    const abortCtrl = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.runFullCompaction(messages, ctx, abortCtrl.signal),
        new Promise<CompactionOutcome>((resolve) => {
          timeoutId = setTimeout(() => {
            abortCtrl.abort();
            logger.warn('compaction:❌tier3 超时（保留 tier2 结果）', {
              sessionId: ctx.sessionId,
              timeoutMs: COMPACTION_TIMEOUT_MS,
            });
            resolve({ messages, applied: false });
          }, COMPACTION_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  /**
   * Tier 3: LLM Full Compaction — 将对话历史压缩为结构化摘要
   * P2-15: 使用 StructuredCompactionPrompt 5 字段结构化格式，
   * 替代自由文本 FULL_COMPACTION_PROMPT，提升信息保留率。
   */
  private async runFullCompaction(
    messages: ChatMessage[],
    ctx: CompactionContext,
    signal?: AbortSignal
  ): Promise<CompactionOutcome> {
    try {
      // C1 修复（压缩链路排查 2026-08-13）：保留头部连续的 system 消息（system prompt
      // 应在列表开头），而非仅取前 2 条过滤——原实现若前 2 条无 system（被 isTaskMessage
      // 过滤/顺序异常）导致 headMessages 为空，原 system prompt（工具定义/角色设定）会
      // 随历史一起被 LLM 压缩进摘要而丢失。
      let headIdx = 0;
      while (headIdx < messages.length && messages[headIdx].role === 'system') {
        headIdx++;
      }
      const headMessages = messages.slice(0, headIdx);
      // 断点 3 修复（2026-08-14 排查）：头部无 system 时**不再跳过**——原实现直接
      // 回退（applied:false）导致纯用户会话 tier3 永不压缩，上下文无限膨胀（实测
      // 单次输入 411 万 tokens，超 128k 上限 32 倍）。无 system prompt 可保护时，
      // 压缩全部消息并以摘要作为新 system 消息注入，行为安全。
      const toCompress =
        headMessages.length === 0 ? messages : messages.slice(headIdx);

      const beforeTokens = estimateMessagesTokens(messages);
      const shadowedTokens = estimateMessagesTokens(toCompress);
      if (shadowedTokens < 50) return { messages, applied: false };
      // P0 压缩超时治理：进入 LLM 调用前再查一次信号，避免超时后仍发起请求
      if (signal?.aborted) return { messages, applied: false };

      // ===== R1（2026-09-16）迭代折叠早轮：让 Tier3 真实降 token =====
      // 根因：原实现**单次**把整个 toCompress（实测 ~170K）压成一条 max_tokens=2560 的
      // 摘要，覆盖严重不足且大段硬校验难达标 → 缩影 `applied:false`，上下文不下降，
      // 每轮还白跑全量 re-tokenize。
      // 方案：从**最早的中间轮**取一小批（≤FOLD_BATCH_SOURCE_TOKENS，单次摘要可覆盖），
      // 生成该批摘要并摘下，循环直至剩余上下文进入目标窗口或无可折叠内容；批量校验
      // 降 token（批内降易达标），保证渐进真实下降。
      // R1：AI 服务优先用注入实例（端到端测试），缺省动态 import 生产 @modules/ai 的 default 导出
      const aiService = this.aiService ?? (await getAiService()).default;
      // P2-15: 优先使用结构化 prompt（5 字段），解析失败时回退到自由文本
      const {
        COMPACTION_USER_PROMPT,
        parseCompactionSummary,
        renderCompactionSummary,
      } = await import('./StructuredCompactionPrompt');

      const folded: string[] = []; // 已摘除早轮摘要（按旧→新顺序）
      let pool = [...toCompress]; // 尚未处理的中间+近期消息（旧→新）
      let iteration = 0;

      while (pool.length > 0 && iteration < FOLD_MAX_ITERATIONS) {
        // P0 压缩超时治理：每个批折叠前再查一次信号，避免超时后仍发起请求
        if (signal?.aborted) {
          logger.warn('compaction:tier3_aborted_mid_fold', {
            iteration,
            foldedBatches: folded.length,
          });
          break;
        }
        // 取最早的一小批（累积到接近 FOLD_BATCH_SOURCE_TOKENS，避免把单条消息打散；
        // 便于单次摘要覆盖该批，批内降 token 易达标）
        const { batch, rest } = extractEarliestBatch(
          pool,
          FOLD_BATCH_SOURCE_TOKENS
        );
        pool = rest;
        const batchTokens = estimateMessagesTokens(batch);
        // 剩余不足 / 无实际可压缩内容 → 保留残余，结束折叠
        if (batch.length === 0 || batchTokens < 100) {
          pool = [...batch, ...pool];
          break;
        }

        // P2-15 结构化摘要单批折叠（P1-1 KV 前缀复用：headMessages + 该批 + 指令）
        // 失败返回 null → 保留残余并停止折叠，不整体回退。
        const summary = await this._foldBatchSummary(
          aiService,
          {
            COMPACTION_USER_PROMPT,
            parseCompactionSummary,
            renderCompactionSummary,
          },
          headMessages,
          batch,
          ctx,
          signal
        );
        if (summary === null) break;

        // 单批有效性校验（P1-2 对齐，作用于"单批"，批内降 token 易达标）：
        // 摘要不得大于被折叠批，否则摘批次放回、停止折叠（避免无效折叠越压越大）。
        const summaryTokens = estimateMessagesTokens([
          { role: 'system', content: summary } as ChatMessage,
        ]);
        if (summaryTokens >= batchTokens) {
          pool = [...batch, ...pool];
          logger.warn('compaction:tier3_fold_summary_not_smaller', {
            batchTokens,
            summaryTokens,
            batchMessages: batch.length,
          });
          break;
        }

        folded.push(summary);
        iteration++;

        // 目标窗口检查：head + 已折叠占位 + 未折叠 pool 已进入目标 → 停
        const assembledTokens = estimateMessagesTokens([
          ...headMessages,
          ...folded.map((f) => ({ role: 'user', content: f }) as ChatMessage),
          ...pool,
        ]);
        logger.debug('compaction:tier3_fold_progress', {
          iteration,
          batchTokens,
          foldedBatches: folded.length,
          poolMessages: pool.length,
          assembledTokens,
          targetTokens: FOLD_TARGET_TOKENS,
        });
        if (assembledTokens <= FOLD_TARGET_TOKENS) break;
      }

      // 一轮结束仍无任何批可折叠 → 无效果
      if (folded.length === 0) {
        logger.warn('compaction:tier3_no_fold', {
          beforeTokens,
          shadowedTokens,
        });
        return { messages, applied: false };
      }

      // 构建压缩后消息：system prompts + 摘要（合并为单条 user）+ 未折叠残余
      const foldedContent = folded.join('\n\n');
      let compacted: ChatMessage[] = [
        ...headMessages,
        {
          // P1-1 修复（2026-08-27）：摘要注入 role 改为 user——原用 system 使摘要与
          // 主 system prompt 并列，部分模型只认最后一条 system → 输出规范
          // （think/response 格式）丢失、把思考当正文（"降智"）。历史摘要不是系统
          // 规范，以 user 消息注入并保留 `<system-info>` 标记供前端/模型识别。
          role: 'user',
          content: foldedContent,
        } as ChatMessage,
        ...pool,
      ];
      // C2 修复（压缩链路排查 2026-08-13）：确保尾部为 user 消息（与 SnipEngine 一致）。
      // 压缩结果尾部若为 assistant（如本轮 user 被 isTaskMessage 过滤），OpenAI/DeepSeek
      // 会返回 400 "Conversation ended with assistant message"。
      compacted = ensureTrailingUserMessage(compacted);

      // P2-1（2026-08-27）：压缩产物 tool 配对完整性——残留 pool 若含孤立的 tool_call/
      // tool_result（其配对消息已被折叠掉），模型收到"无配对的工具消息"会污染上下文
      // （重演"连续 assistant/空 assistant"空响应）。基于压缩后集合剥离孤立项。
      {
        const pairedCallIds = collectToolCallIds(compacted);
        compacted = stripUnpairedToolResults(compacted, pairedCallIds);
        const pairedResultIds = collectToolResultIds(compacted);
        compacted = stripUnpairedToolCalls(compacted, pairedResultIds);
        compacted = ensureTrailingUserMessage(compacted);
      }

      // ② 兜底校验：压缩后整体须小于压缩前全部消息（不能越压越大）
      const afterTokens = estimateMessagesTokens(compacted);
      if (afterTokens >= beforeTokens) {
        logger.warn('compaction:tier3_no_reduction', {
          beforeTokens,
          afterTokens,
          foldedBatches: folded.length,
        });
        return { messages, applied: false };
      }

      logger.info('compaction:tier3_applied_iterative', {
        beforeTokens,
        afterTokens,
        foldedBatches: folded.length,
        iterations: iteration,
      });

      return {
        messages: compacted,
        applied: true,
        // 迭代折叠为多次摘要调用，单次 usage 不代表整体——故省略可重建信封，仅保留 structured 标记
        summaryEnvelope: {
          model: ctx.model,
          maxTokens: 2560,
          structured: true,
        },
      };
    } catch (err) {
      await handleError(err, { module: 'context:compaction', action: 'full' });
      return { messages, applied: false };
    }
  }

  /**
   * 检查压缩后是否仍超出预算（用于判断是否需要升到 Tier 3）
   * C7 收敛：评估统一走 UnifiedTokenTracker.checkBeforeRequest（异步）
   */
  private async isStillOverBudget(
    messages: ChatMessage[],
    ctx: CompactionContext
  ): Promise<boolean> {
    const decision = await this.evaluateCompaction(messages, ctx);
    return decision.decision === 'trigger';
  }

  /**
   * R1（2026-09-16）：折叠**单批**消息为结构化摘要（temperature 0.3 / max_tokens 2560）。
   * 摘要请求 = head system prompt + 被折叠批原始结构 + 压缩指令收尾（P1-1 KV 前缀复用）。
   * 失败（LLM 报错 / 返回空 / 超时 signal）返回 null，由调用方保留残余并停止折叠。
   */
  private async _foldBatchSummary(
    aiService: { generate: Function },
    procs: {
      COMPACTION_USER_PROMPT: string;
      parseCompactionSummary: typeof ParseCompactionSummaryFn;
      renderCompactionSummary: typeof RenderCompactionSummaryFn;
    },
    headMessages: ChatMessage[],
    batch: ChatMessage[],
    ctx: CompactionContext,
    signal?: AbortSignal
  ): Promise<string | null> {
    try {
      // R6（2026-09-21）：发请求前**兜底收敛配对** —— 保证任何切片都满足
      // "带 tool_calls 的 assistant 后面必须跟齐其 tool 结果"（含孤立 tool 消息），
      // 否则上游整请求 400（真机实证的 `tier3_fold_batch_error`）。
      const apiMessages: ChatMessage[] = sanitizeToolCallPairs([
        ...headMessages,
        ...batch,
        // 压缩指令收尾（作为最后 user 消息，与 deepseek-harness 的 COMPACTION_INSTRUCTION 一致）
        { role: 'user', content: procs.COMPACTION_USER_PROMPT } as ChatMessage,
      ]);

      const response = await aiService.generate(apiMessages, ctx.model || '', {
        // 超时治理：max_tokens 4096 → 2560——5 字段摘要上限共 ~1400 字（≈2000-2500 tokens），
        // 2560 足够且显著缩短 LLM 生成时间（4096 上限是浪费），降低 Tier3 超时概率
        temperature: 0.3,
        max_tokens: 2560,
        signal,
      });

      const raw = response.content?.trim();
      if (!raw) return null;

      // P2-15: 尝试解析结构化 JSON，成功则使用结构化渲染；失败回退纯文本摘录
      const structured = procs.parseCompactionSummary(raw);
      if (structured) {
        logger.debug('compaction:tier3_fold_structured', {
          fields: Object.keys(structured).filter(
            (k) => (structured as Record<string, unknown>)[k]
          ),
        });
        return procs.renderCompactionSummary(structured);
      }
      logger.debug('compaction:tier3_fold_fallback_text', {
        rawLength: raw.length,
        reason: 'parseCompactionSummary returned null',
      });
      return `[Previous conversation summary]\n${raw}`;
    } catch (err) {
      // 单批折叠失败不整体回退——调用方保留残余并停止折叠（暂不需 handleError 上报主链路）
      // @ignore-catch: Tier3 所有批都失败时 runFullCompaction 走 applied:false；此处避免
      //  汇总多次 handleError 刷 ErrorTracker。
      logger.warn('compaction:tier3_fold_batch_error', {
        error: String(err),
      });
      return null;
    }
  }
}

/** 默认编排器实例 */
export const compactionOrchestrator = new CompactionOrchestrator();
