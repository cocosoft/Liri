/**
 * 审查结果模型
 *
 * Reviewer SubAgent 对执行结果的审查，包含通过/分数/问题清单。
 * Orchestrator 根据此结果决定 approve / retry / skip / escalate。
 */

/** 审查问题 */
export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor';
  description: string;
  suggestion?: string;
  file?: string;
  line?: number;
}

/** 审查结果 */
export interface PlanReview {
  stepId: string;
  pass: boolean;
  score: number;           // 0-100
  issues: ReviewIssue[];
  summary: string;
  reviewedAt: number;
  reviewerAgentId?: string;
}

/** 审查决策 */
export type ReviewDecision = 'approved' | 'retry' | 'skip' | 'escalate';

/** 带审查的 PlanStep 扩展 */
export interface ReviewableStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  acceptanceCriteria: string;
  reviewResult?: PlanReview;
  retryCount: number;
  maxRetries: number;
  decision?: ReviewDecision;
}

/**
 * 判断审查是否可通过
 * 只 flag critical/major 为阻塞项，minor 不阻塞
 */
export function isReviewPassed(review: PlanReview): boolean {
  if (!review.pass) return false;
  const blocking = review.issues.filter(
    (i) => i.severity === 'critical' || i.severity === 'major',
  );
  return blocking.length === 0;
}

/**
 * 从 LLM 审查输出解析 PlanReview
 */
export function parseReviewFromText(
  text: string,
  stepId: string,
  reviewerAgentId?: string,
): PlanReview {
  // 尝试解析 JSON
  try {
    const parsed = JSON.parse(text);
    return {
      stepId,
      pass: Boolean(parsed.pass),
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((i: any) => ({
            severity: i.severity || 'minor',
            description: String(i.description || ''),
            suggestion: i.suggestion ? String(i.suggestion) : undefined,
            file: i.file ? String(i.file) : undefined,
          }))
        : [],
      summary: String(parsed.summary || ''),
      reviewedAt: Date.now(),
      reviewerAgentId,
    };
  } catch {
    // 非 JSON 结果：提取关键信息
    const pass =
      /(?:\bpass\b|\b通过\b|\bcompleted\b|✅)/i.test(text) &&
      !/(?:\bfail\b|\b失败\b|\berror\b|❌)/i.test(text);
    return {
      stepId,
      pass,
      score: pass ? 70 : 30,
      issues: pass
        ? []
        : [
            {
              severity: 'major',
              description: text.slice(0, 500),
            },
          ],
      summary: text.slice(0, 200),
      reviewedAt: Date.now(),
      reviewerAgentId,
    };
  }
}

/**
 * 格式化审查摘要为人类可读的字符串
 */
export function formatReviewSummary(review: PlanReview): string {
  const status = review.pass ? '✅ 通过' : '❌ 未通过';
  const critical = review.issues.filter((i) => i.severity === 'critical').length;
  const major = review.issues.filter((i) => i.severity === 'major').length;
  const minor = review.issues.filter((i) => i.severity === 'minor').length;

  return [
    `${status}（评分: ${review.score}/100）`,
    critical > 0 ? `严重: ${critical}` : '',
    major > 0 ? `重要: ${major}` : '',
    minor > 0 ? `次要: ${minor}` : '',
    review.summary ? `\n摘要: ${review.summary}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}
