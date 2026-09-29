import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\TimeTool\schemas');

/**
 * TimeTool 输入模式
 */
export const TimeInputSchema = z.strictObject({
  format: z
    .enum(['iso', 'local', 'unix'])
    .optional()
    .default('local')
    .describe('时间格式'),
  timezone: z
    .string()
    .optional()
    .describe('时区（如 "Asia/Shanghai", "America/New_York"）'),
});

export type TimeInputType = z.infer<typeof TimeInputSchema>;

/**
 * ⚠️ `TimeOutputSchema`（`{time, format, timezone, timestamp}`）已于 2026-09-29 删除（T6 分批处置 · 批次 4b）。
 *
 * 原因（实证）：该工具**仅两处出口** —— 成功分支 `data = JSON.stringify(result)`（**字符串**，
 * 且 `result` 按 format 有三种互不相同的字段集：iso→`{iso,timestamp,timezone}`、
 * unix→`{timestamp,seconds,timezone}`、local→`{local,date,time,timestamp,timezone}`）与 `data = null`
 * ⇒ 与"固定 4 字段对象"schema **完全不符**。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * 验证 TimeTool 输入
 */
export function validateTimeInput(input: unknown): TimeInputType {
  const result = TimeInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Time输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
