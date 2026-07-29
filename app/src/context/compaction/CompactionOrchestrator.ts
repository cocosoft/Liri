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
} from './AutoCompactionPolicy';
import { applyMicroCompaction } from './MicroCompactionEngine';
import { snipMessages } from './SnipEngine';
import { hookRegistry } from '../hooks/CompactionHooks';
import { compactionMetricsTracker } from './CompactionMetrics';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'context:compaction:orchestrator',
  level: LogLevel.INFO,
});

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

/** 压缩超时上限（毫秒），超时后回滚到原消息 */
const COMPACTION_TIMEOUT_MS = 10_000;

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
   * @returns 压缩后的消息，以及是否应用了压缩
   */
  async compact(
    messages: ChatMessage[],
    ctx: CompactionContext
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
      const decision = this.policy.evaluate(
        messages,
        ctx.model,
        ctx.configOverride
      );

      // Skip：无需压缩
      if (decision.decision === 'skip') {
        logger.debug('compaction:skip', {
          ratio: Number(decision.snapshot.ratio.toFixed(3)),
          reason: decision.reason ?? 'below warning threshold',
        });
        return { messages, applied: false };
      }

      // 超时保护：压缩整体不得超过 COMPACTION_TIMEOUT_MS
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const abortCtrl = new AbortController();
      try {
        const result = await Promise.race([
          this._doCompact(messages, ctx, decision, startTime, abortCtrl.signal),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              abortCtrl.abort(); // BUG-G fix: cancel ongoing _doCompact
              reject(new Error('COMPACTION_TIMEOUT'));
            }, COMPACTION_TIMEOUT_MS);
          }),
        ]);
        return result;
      } catch (err) {
        if (err instanceof Error && err.message === 'COMPACTION_TIMEOUT') {
          logger.warn('compaction:timeout', {
            sessionId: ctx.sessionId,
            beforeTokens: decision.snapshot.tokens,
            timeoutMs: COMPACTION_TIMEOUT_MS,
            elapsedMs: Date.now() - startTime,
          });
          return { messages, applied: false };
        }
        // 非超时错误：记录 + 返回 fallback，不抛向上层（上层可能没有 catch）
        await handleError(err, {
          module: 'context:compaction',
          action: 'compact',
        });
        return { messages, applied: false };
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    } finally {
      if (ctx.sessionId) activeCompactions.delete(ctx.sessionId);
    }
  }

  /** 执行压缩管线（不含超时保护，由 compact() 外层处理） */
  private async _doCompact(
    messages: ChatMessage[],
    ctx: CompactionContext,
    decision: ReturnType<AutoCompactionPolicy['evaluate']>,
    startTime: number,
    signal?: AbortSignal
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
        // BUG-ζ fix: check abort signal before Tier 2 (snip is sync but still adds overhead after timeout)
        if (signal?.aborted) {
          return { messages, applied: false };
        }
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

      // Tier 2 无效或仍超限 → 尝试 Tier 3 LLM Full Compaction
      if (!result.applied || this.isStillOverBudget(result.messages, ctx)) {
        // BUG-G fix: skip LLM call if already aborted (avoid side effects after timeout)
        if (signal?.aborted) {
          logger.debug('compaction:tier3_skipped', { reason: 'aborted' });
          return { messages, applied: false };
        }

        logger.info('compaction:escalating_to_tier3', {
          reason: result.applied ? 'snip_insufficient' : 'snip_no_effect',
          beforeTokens,
        });

        const fullResult = await this.runFullCompaction(result.messages, ctx);
        if (fullResult.applied) {
          tier = 3;
          triggerLabel = 'full_compaction';
          result = fullResult;
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
   * Tier 3: LLM Full Compaction — 将对话历史压缩为结构化摘要
   * P2-15: 使用 StructuredCompactionPrompt 5 字段结构化格式，
   * 替代自由文本 FULL_COMPACTION_PROMPT，提升信息保留率。
   */
  private async runFullCompaction(
    messages: ChatMessage[],
    ctx: CompactionContext
  ): Promise<{ messages: ChatMessage[]; applied: boolean }> {
    try {
      // 取头部 2 条（通常是 system prompt）+ 构建要压缩的文本
      const headMessages = messages
        .slice(0, 2)
        .filter((m) => m.role === 'system');
      const toCompress = messages.slice(headMessages.length);

      const conversationText = toCompress
        .map(
          (m) =>
            `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
        )
        .join('\n\n');

      if (conversationText.length < 200) return { messages, applied: false };

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
        { temperature: 0.3, max_tokens: 4096 }
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
      const compacted: ChatMessage[] = [
        ...headMessages,
        {
          role: 'system',
          content: summary,
        } as ChatMessage,
        ...tailMessages,
      ];

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
