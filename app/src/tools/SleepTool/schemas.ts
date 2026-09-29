import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\SleepTool\schemas');

/**
 * SleepTool 输入模式
 */
export const SleepInputSchema = z.strictObject({
  milliseconds: z
    .number()
    .int()
    .positive()
    .max(300000)
    .describe('延迟的毫秒数（上限5分钟）'),
});

export type SleepInputType = z.infer<typeof SleepInputSchema>;

/**
 * ⚠️ `SleepOutputSchema`（`{sleptMs, message}`）已于 2026-09-29 删除（T6 分批处置 · 批次 2）。
 *
 * 原因（实证）：该工具**手工构造 `ToolResult`**（不用 `createToolResult`），且成功分支的
 * `data` 是 `{durationMs, elapsed, reason}` —— 与 `{sleptMs, message}` **字段名全不同**；
 * 失败分支**无 `data`**（且已标 `success: false`）⇒ 不符 ⇒ 接上必每次误报。
 *
 * ⚠️ **顺带发现（同类漂移，未修）**：本文件的**入参** schema 写的是 `milliseconds`，
 * 而工具实际读取的是 `durationMs`（`SleepTool.ts:45`）⇒ 入参侧**也**与实现不一致
 * （同 D-7 记录的那类"孤立 schema 与实现脱节"）。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * 验证 SleepTool 输入
 */
export function validateSleepInput(input: unknown): SleepInputType {
  const result = SleepInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Sleep输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
