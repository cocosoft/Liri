import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\MonitorTool\schemas');

/**
 * MonitorTool 输入模式
 */
export const MonitorInputSchema = z.strictObject({
  metric: z
    .enum(['memory', 'cpu', 'disk', 'network'])
    .optional()
    .default('memory')
    .describe('监控指标类型'),
});

export type MonitorInputType = z.infer<typeof MonitorInputSchema>;

/**
 * ⚠️ `MonitorOutputSchema`（`{metric, value, unit?, timestamp}`）已于 2026-09-29 删除（T6 分批处置 · 批次 2）。
 *
 * 原因（实证）：该工具**手工构造 `ToolResult`**（不用 `createToolResult`），成功分支的 `data`
 * 是 `{metric, ...result}`，而 `result` 有 **4 种形态**（`getMemoryUsage` = `{heapTotal, heapUsed,
 * external, rss, heapTotalMB, heapUsedMB}`；`getCPUUsage` = `{usage}`；`getDiskUsage` /
 * `getNetworkUsage` = `{message}`）—— **四种全都没有 schema 要求的 `value` 与 `timestamp`**
 * ⇒ 不符 ⇒ 接上必每次误报。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * 验证 MonitorTool 输入
 */
export function validateMonitorInput(input: unknown): MonitorInputType {
  const result = MonitorInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Monitor输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
