import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\GrepTool\schemas');

/**
 * GrepTool 输出模式枚举
 */
export const GrepOutputModeSchema = z.enum([
  'content',
  'files_with_matches',
  'count',
]);
export type GrepOutputModeType = z.infer<typeof GrepOutputModeSchema>;

/**
 * GrepTool 输入模式
 */
export const GrepInputSchema = z.strictObject({
  pattern: z
    .string()
    .min(1, '搜索模式不能为空')
    .describe('用于匹配的正则表达式模式'),
  searchPath: z
    .string()
    .optional()
    .describe('搜索的根目录路径，默认为当前工作目录'),
  include: z.string().optional().describe('文件包含模式'),
  outputMode: GrepOutputModeSchema.optional().describe('输出模式'),
  contextBefore: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('匹配前显示的行数'),
  contextAfter: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('匹配后显示的行数'),
  contextAround: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('匹配前后显示的行数'),
  showLineNumbers: z.boolean().optional().describe('是否显示行号'),
  caseInsensitive: z.boolean().optional().describe('是否忽略大小写'),
  type: z.string().optional().describe('文件类型过滤器'),
  headLimit: z
    .number()
    .int()
    .min(
      1,
      'headLimit 必须为 ≥1 的整数（默认 200；结果过多会被截断，需要更多请调大该值）'
    )
    .optional()
    .describe('最大返回结果数'),
  offset: z.number().int().nonnegative().optional().describe('结果偏移量'),
  multiline: z.boolean().optional().describe('是否启用多行匹配'),
});

export type GrepInputType = z.infer<typeof GrepInputSchema>;

/**
 * GrepTool 输出模式
 */
export const GrepOutputSchema = z.object({
  matches: z.array(z.string()).describe('匹配结果列表'),
  matchCount: z.number().int().nonnegative().describe('匹配总数'),
  fileCount: z.number().int().nonnegative().describe('匹配文件数'),
  truncated: z.boolean().describe('是否被截断'),
  durationMs: z.number().int().nonnegative().describe('执行耗时（毫秒）'),
});

export type GrepOutputType = z.infer<typeof GrepOutputSchema>;

/** 允许参数清单（校验失败时回给模型的引导文本） */
const GREP_ALLOWED_PARAM_KEYS =
  'pattern, searchPath(兼容别名 path), include, outputMode, contextBefore, contextAfter, contextAround, showLineNumbers, caseInsensitive, type, headLimit, offset, multiline';

/**
 * F1（2026-09-04）：参数别名归一。
 * 模型常沿用其他工具习惯把搜索目录写成 path——入库前归一到 searchPath
 * （searchPath 显式存在时以 searchPath 为准），避免 strictObject 拒收引发失败-重试空转。
 */
function normalizeGrepInputAliases(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  const input = { ...(raw as Record<string, unknown>) };
  if (input.path !== undefined) {
    if (input.searchPath === undefined) {
      input.searchPath = input.path;
    }
    delete input.path;
  }
  return input;
}

/**
 * 验证 GrepTool 输入
 */
export function validateGrepInput(input: unknown): GrepInputType {
  const normalized = normalizeGrepInputAliases(input);
  const result = GrepInputSchema.safeParse(normalized);
  if (!result.success) {
    const hasUnknownKeys = result.error.issues.some(
      (issue) => issue.code === 'unrecognized_keys'
    );
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    // F1：unrecognized 键附带允许参数清单，引导模型下次自纠而不是盲目重试
    const hint = hasUnknownKeys
      ? `；仅允许以下参数: ${GREP_ALLOWED_PARAM_KEYS}`
      : '';
    throw new AppError(
      `Grep输入验证失败: ${errors}${hint}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
