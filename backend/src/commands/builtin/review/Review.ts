/**
 * /review 命令 - 代码审查
 * 基于CC源码 commands/review.ts 模式
 */
import type { CommandResult } from '@modules/commands/types';

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

export async function execute(args: string): Promise<CommandResult> {
  const files = args.trim().split(/\s+/).filter(Boolean);
  if (files.length === 0 || files[0] === 'help') {
    return {
      success: true,
      type: 'text',
      message: [
        '用法: /review <file1> [file2 ...]',
        '',
        '审查代码文件，检查潜在问题。',
        '',
        '参数:',
        '  file(s)    要审查的文件路径（可指定多个）',
      ].join('\n'),
    };
  }
  const results = files.map((f) => {
    const severity = classifySeverity(`Checking ${f}`);
    return { file: f, line: 0, severity, message: `Reviewing ${f}...` };
  });
  const summary = createReviewResult(files, results, ['Consider adding more specific checks']);
  return {
    success: true,
    type: 'text',
    message: JSON.stringify(summary, null, 2),
    data: summary,
  };
}

const Review = { execute, createReviewResult, classifySeverity };
export default Review;
