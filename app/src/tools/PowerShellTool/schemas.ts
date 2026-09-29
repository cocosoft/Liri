import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\PowerShellTool\schemas');

/**
 * PowerShellTool 输入模式
 * 安全审计修复：移除 skipSecurityCheck 参数
 */
export const PowerShellInputSchema = z.strictObject({
  command: z.string().min(1, '命令不能为空').describe('要执行的PowerShell命令'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(300000)
    .optional()
    .default(60000)
    .describe('超时时间（毫秒）'),
  workingDirectory: z.string().optional().describe('命令工作目录'),
  executionPolicy: z
    .string()
    .optional()
    .default('Bypass')
    .describe('PowerShell执行策略'),
});

export type PowerShellInputType = z.infer<typeof PowerShellInputSchema>;

/**
 * ⚠️ `PowerShellOutputSchema`（`{output, executionTime, exitCode?}`）已于 2026-09-29 删除（T6 分批处置 · 批次 4b）。
 *
 * 原因（实证）：成功出口 `createSuccessResult(output, {executionTime, output})` 的 `data` 是
 * **字符串**（`PowerShellTool.ts:526` 的 `output`）⇒ 与"对象"schema **不符**；6 处失败分支经
 * `createFailureResult` 自带 `success: false`（豁免）。
 * ⚠️ **与 `bash` 完全同型**：本目录 `PowerShellTool.ts:224` 另有**本地同名常量** `PowerShellOutputSchema`
 * （描述**内层函数**的返回，不是工具出口）—— 该本地常量**不在本次处置范围**。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * 验证 PowerShellTool 输入
 */
export function validatePowerShellInput(input: unknown): PowerShellInputType {
  const result = PowerShellInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `PowerShell输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
