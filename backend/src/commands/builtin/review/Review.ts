/**
 * /review 命令 - 代码审查
 * 基于CC源码 commands/review.ts 模式
 */

export interface ReviewResult {
  summary: string;
  issues: ReviewIssue[];
  suggestions: string[];
  fileCount: number;
}

export interface ReviewIssue {
  file: string;
  line?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

export function createReviewResult(
  files: string[],
  issues: ReviewIssue[] = [],
  suggestions: string[] = [],
): ReviewResult {
  return {
    summary: `Review completed: ${files.length} files, ${issues.length} issues found`,
    issues,
    suggestions: suggestions.length > 0 ? suggestions : ['Code looks clean'],
    fileCount: files.length,
  };
}

export function classifySeverity(
  message: string,
): 'error' | 'warning' | 'info' {
  if (/security|injection|vulnerability/i.test(message)) return 'error';
  if (/deprecated|anti-pattern|inefficient/i.test(message)) return 'warning';
  return 'info';
}
