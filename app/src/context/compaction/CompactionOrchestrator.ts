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

      // Tier 2 无效或仍超限 → 尝试 Tier 3 LLM Full Compaction
      if (!result.applied || this.isStillOverBudget(result.messages, ctx)) {
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

      const { default: aiService, AIMessageRole } =
        await import('../../ai/index');
      const response = await aiService.generate(
        [
          { role: AIMessageRole.SYSTEM, content: FULL_COMPACTION_PROMPT },
          { role: AIMessageRole.USER, content: conversationText },
        ],
        ctx.model || '', // 使用当前会话同一模型（质量优先）
        { temperature: 0.3, max_tokens: 4096 }
      );

      const summary = response.content?.trim();
      if (!summary) return { messages, applied: false };

      // 构建压缩后消息：system prompts + 摘要 + 最后 2 条尾部消息
      const tailMessages = toCompress.slice(-2);
      const compacted: ChatMessage[] = [
        ...headMessages,
        {
          role: 'system',
          content: `[Previous conversation summary]\n${summary}`,
        } as ChatMessage,
        ...tailMessages,
      ];

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
