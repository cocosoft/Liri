/**
 * CompactionOrchestrator — 压缩编排器（Phase 5 集成回线）
 *
 * 串联 AutoCompactionPolicy → MicroCompactionEngine / SnipEngine / LLM Full
 * 注入 CompactionHooks 生命周期 + CompactionMetrics 追踪
 *
 * 管线：
 *   1. AutoCompactionPolicy.evaluate() → skip / warn / trigger
 *   2. skip → 返回原消息
 *   3. warn → 尝试 Tier 1（Micro），无效则 Tier 2（Snip）
 *   4. trigger → 执行 Tier 2（Snip），无效则 Tier 3（LLM Full）
 *   5. 每次压缩前后调用 hookRegistry + compactionMetricsTracker
 */
import type { ChatMessage } from '../../ai/models/types';
import { estimateMessagesTokens } from '../../ai/tokenizer/TokenEstimator';
import {
  AutoCompactionPolicy,
  autoCompactionPolicy,
  type AutoCompactionDecision,
} from './AutoCompactionPolicy';
import { applyMicroCompaction } from './MicroCompactionEngine';
import { snipMessages } from './SnipEngine';
import { ensureTrailingUserMessage } from './toolPairIntegrity';
import { hookRegistry } from '../hooks/CompactionHooks';
import { compactionMetricsTracker } from './CompactionMetrics';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('context:compaction:orchestrator');

// 缓存动态 import 避免每次 Tier 3 压缩重复解析模块
let cachedAiModule: {
  default: { generate: Function };
  AIMessageRole: Record<string, string>;
} | null = null;

async function getAiService() {
  if (!cachedAiModule) {
    const mod = (await import('../../ai/index')) as {
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

export interface CompactionOrchestratorOptions {
  policy?: AutoCompactionPolicy;
}

/** 正在执行压缩的会话 ID 集合，防止双管线并发压缩同一会话 */
const activeCompactions = new Set<string>();

export class CompactionOrchestrator {
  private policy: AutoCompactionPolicy;

  constructor(options: CompactionOrchestratorOptions = {}) {
    this.policy = options.policy ?? autoCompactionPolicy;
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
    options?: { skipTier3Sync?: boolean; preEvaluated?: AutoCompactionDecision }
  ): Promise<{ messages: ChatMessage[]; applied: boolean }> {
    // 防止双管线并发压缩同一会话
    if (ctx.sessionId) {
      if (activeCompactions.has(ctx.sessionId)) {
        logger.debug('compaction:already_in_progress', {
          sessionId: ctx.sessionId,
        });
        return { messages, applied: false };
      }
      activeCompactions.add(ctx.sessionId);
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
        this.policy.evaluate(messages, ctx.model, ctx.configOverride);
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
      let result: { messages: ChatMessage[]; applied: boolean };
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
      if (ctx.sessionId) activeCompactions.delete(ctx.sessionId);
    }
  }

  /**
   * 后台异步压缩会话消息（项1 落地，会话排查 2026-08-13）：
   * 发送完成后 fire-and-forget 调用，压缩结果写回会话，下一轮发送窗口更小
   * （可能 skip/warn 而非触发慢 Tier3），从而把 Tier3 的等待从"用户发送前"
   * 转移到"发送后后台"。
   * 长度守卫：压缩期间会话消息数量变化（有新消息/删除）→ 放弃写回，避免覆盖新增。
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
    // 守卫：压缩期间消息有变更 → 放弃写回（避免覆盖压缩期间新增的消息）
    if (getMessages().length !== snapshotCount) {
      logger.warn('compaction:bg_skip — 压缩期间消息有变更，放弃写回', {
        sessionId: ctx.sessionId,
        snapshotCount,
        currentCount: getMessages().length,
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
    decision: ReturnType<AutoCompactionPolicy['evaluate']>,
    startTime: number,
    options?: { skipTier3Sync?: boolean }
  ): Promise<{ messages: ChatMessage[]; applied: boolean }> {
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

    let result: { messages: ChatMessage[]; applied: boolean };
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
      if (!result.applied || this.isStillOverBudget(result.messages, ctx)) {
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

    // 记录反抖动数据（Tier 2 及以上）
    if (tier >= 2) {
      this.policy.recordSaving(savingPercent);
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
  ): Promise<{ messages: ChatMessage[]; applied: boolean }> {
    const abortCtrl = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.runFullCompaction(messages, ctx, abortCtrl.signal),
        new Promise<{ messages: ChatMessage[]; applied: boolean }>(
          (resolve) => {
            timeoutId = setTimeout(() => {
              abortCtrl.abort();
              logger.warn('compaction:❌tier3 超时（保留 tier2 结果）', {
                sessionId: ctx.sessionId,
                timeoutMs: COMPACTION_TIMEOUT_MS,
              });
              resolve({ messages, applied: false });
            }, COMPACTION_TIMEOUT_MS);
          }
        ),
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
  ): Promise<{ messages: ChatMessage[]; applied: boolean }> {
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

      const conversationText = toCompress
        .map(
          (m) =>
            `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
        )
        .join('\n\n');

      if (conversationText.length < 200) return { messages, applied: false };
      // P0 压缩超时治理：进入 LLM 调用前再查一次信号，避免超时后仍发起请求
      if (signal?.aborted) return { messages, applied: false };

      const { default: aiService, AIMessageRole } = await getAiService();

      // P2-15: 优先使用结构化 prompt（5 字段），解析失败时回退到自由文本
      const {
        COMPACTION_SYSTEM_PROMPT,
        COMPACTION_USER_PROMPT,
        parseCompactionSummary,
        renderCompactionSummary,
      } = await import('./StructuredCompactionPrompt');

      const response = await aiService.generate(
        [
          { role: AIMessageRole.SYSTEM, content: COMPACTION_SYSTEM_PROMPT },
          {
            role: AIMessageRole.USER,
            content: `${COMPACTION_USER_PROMPT}\n\n${conversationText}`,
          },
        ],
        ctx.model || '',
        // 超时治理：max_tokens 4096 → 2560——5 字段摘要上限共 ~1400 字（≈2000-2500 tokens），
        // 2560 足够且显著缩短 LLM 生成时间（4096 上限是浪费），降低 Tier3 超时概率
        { temperature: 0.3, max_tokens: 2560, signal }
      );

      let summary: string;
      const raw = response.content?.trim();
      if (!raw) return { messages, applied: false };

      // P2-15: 尝试解析结构化 JSON，成功则使用结构化渲染
      const structured = parseCompactionSummary(raw);
      if (structured) {
        summary = renderCompactionSummary(structured);
        logger.debug('compaction:tier3_structured', {
          fields: Object.keys(structured).filter(
            (k) => (structured as Record<string, string>)[k]
          ),
        });
      } else {
        // 回退：LLM 未返回有效 JSON，使用原始文本（仅保留纯文本摘要格式）
        logger.debug('compaction:tier3_fallback_text', {
          rawLength: raw.length,
          reason: 'parseCompactionSummary returned null',
        });
        summary = `[Previous conversation summary]\n${raw}`;
      }

      // 构建压缩后消息：system prompts + 摘要 + 最后 2 条尾部消息
      const tailMessages = toCompress.slice(-2);
      let compacted: ChatMessage[] = [
        ...headMessages,
        {
          role: 'system',
          content: summary,
        } as ChatMessage,
        ...tailMessages,
      ];
      // C2 修复（压缩链路排查 2026-08-13）：确保尾部为 user 消息（与 SnipEngine 一致）。
      // 压缩结果尾部若为 assistant（如本轮 user 被 isTaskMessage 过滤），OpenAI/DeepSeek
      // 会返回 400 "Conversation ended with assistant message"。
      compacted = ensureTrailingUserMessage(compacted);

      // 校验：压缩后 token 应少于压缩前，否则回退
      const beforeTokens = estimateMessagesTokens(toCompress);
      const afterTokens = estimateMessagesTokens(compacted);
      if (afterTokens >= beforeTokens) {
        logger.warn('compaction:tier3_no_reduction', {
          beforeTokens,
          afterTokens,
          summaryLength: summary.length,
          structured: !!structured,
        });
        return { messages, applied: false };
      }

      return { messages: compacted, applied: true };
    } catch (err) {
      await handleError(err, { module: 'context:compaction', action: 'full' });
      return { messages, applied: false };
    }
  }

  /**
   * 检查压缩后是否仍超出预算（用于判断是否需要升到 Tier 3）
   */
  private isStillOverBudget(
    messages: ChatMessage[],
    ctx: CompactionContext
  ): boolean {
    const decision = this.policy.evaluate(
      messages,
      ctx.model,
      ctx.configOverride
    );
    return decision.decision === 'trigger';
  }

  /** 获取当前压缩策略 */
  getPolicy(): AutoCompactionPolicy {
    return this.policy;
  }

  /** 重置压缩状态（新会话开始时调用） */
  reset(): void {
    this.policy.reset();
  }
}

/** 默认编排器实例 */
export const compactionOrchestrator = new CompactionOrchestrator();
