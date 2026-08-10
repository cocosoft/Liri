/**
 * Agent 结果分类器
 * 统一分类 Agent 执行结果
 * 对齐 OpenClaw agents/harness/result-classification.ts
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('agent:resultClassifier');

export type AgentResultClassification =
  | 'ok'
  | 'error'
  | 'timeout'
  | 'budget_exceeded'
  | 'max_turns_exceeded'
  | 'aborted'
  | 'permission_denied'
  | 'rate_limited'
  | 'context_overflow'
  | 'model_unavailable'
  | 'unknown';

export interface ClassifyContext {
  exitCode?: number;
  error?: unknown;
  turnCount: number;
  maxTurns: number;
  budgetUsed?: number;
  budgetLimit?: number;
  aborted?: boolean;
  permissionDenied?: boolean;
}

export interface ClassifiedResult {
  classification: AgentResultClassification;
  isRetryable: boolean;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

const CLASSIFICATION_MAP: Record<
  AgentResultClassification,
  { isRetryable: boolean; defaultSeverity: ClassifiedResult['severity'] }
> = {
  ok: { isRetryable: false, defaultSeverity: 'info' },
  error: { isRetryable: true, defaultSeverity: 'error' },
  timeout: { isRetryable: true, defaultSeverity: 'warning' },
  budget_exceeded: { isRetryable: false, defaultSeverity: 'warning' },
  max_turns_exceeded: { isRetryable: false, defaultSeverity: 'warning' },
  aborted: { isRetryable: false, defaultSeverity: 'info' },
  permission_denied: { isRetryable: false, defaultSeverity: 'warning' },
  rate_limited: { isRetryable: true, defaultSeverity: 'warning' },
  context_overflow: { isRetryable: true, defaultSeverity: 'warning' },
  model_unavailable: { isRetryable: true, defaultSeverity: 'error' },
  unknown: { isRetryable: true, defaultSeverity: 'error' },
};

export class ResultClassifier {
  classify(ctx: ClassifyContext): ClassifiedResult {
    const classification = this.determineClassification(ctx);
    const meta = CLASSIFICATION_MAP[classification];

    return {
      classification,
      isRetryable: meta.isRetryable,
      message: this.buildMessage(classification, ctx),
      severity: meta.defaultSeverity,
    };
  }

  private determineClassification(
    ctx: ClassifyContext
  ): AgentResultClassification {
    if (ctx.aborted) return 'aborted';
    if (ctx.permissionDenied) return 'permission_denied';
    if (ctx.turnCount >= ctx.maxTurns) return 'max_turns_exceeded';
    if (
      ctx.budgetUsed !== undefined &&
      ctx.budgetLimit !== undefined &&
      ctx.budgetUsed >= ctx.budgetLimit
    ) {
      return 'budget_exceeded';
    }
    if (ctx.error) {
      return this.classifyError(ctx.error);
    }
    return 'ok';
  }

  private classifyError(error: unknown): AgentResultClassification {
    const msg =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    if (msg.includes('rate limit') || msg.includes('429'))
      return 'rate_limited';
    if (
      msg.includes('context') &&
      (msg.includes('limit') || msg.includes('overflow'))
    )
      return 'context_overflow';
    if (msg.includes('model') && msg.includes('unavailable'))
      return 'model_unavailable';
    if (msg.includes('permission')) return 'permission_denied';
    return 'error';
  }

  private buildMessage(
    classification: AgentResultClassification,
    ctx: ClassifyContext
  ): string {
    const messages: Record<AgentResultClassification, string> = {
      ok: '执行成功',
      error: `错误: ${ctx.error instanceof Error ? ctx.error.message : String(ctx.error || '未知错误')}`,
      timeout: '执行超时',
      budget_exceeded: `预算超出 (已用: ${ctx.budgetUsed}, 限制: ${ctx.budgetLimit})`,
      max_turns_exceeded: `达到最大轮次 (${ctx.turnCount}/${ctx.maxTurns})`,
      aborted: '用户中断',
      permission_denied: '权限不足',
      rate_limited: 'API 频率限制',
      context_overflow: '上下文溢出',
      model_unavailable: '模型不可用',
      unknown: '未知结果',
    };
    return messages[classification];
  }
}

export const resultClassifier = new ResultClassifier();
