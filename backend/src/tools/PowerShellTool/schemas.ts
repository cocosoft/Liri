import { z } from 'zod';

/**
 * PowerShellTool 输入模式
 */
export const PowerShellInputSchema = z.strictObject({
  command: z.string().min(1, '命令不能为空').describe('要执行的PowerShell命令'),
  timeout: z.number().int().positive().max(300000).optional().default(60000).describe('超时时间（毫秒）'),
  skipSecurityCheck: z.boolean().optional().default(false).describe('跳过安全检查（危险）'),
  workingDirectory: z.string().optional().describe('命令工作目录'),
  executionPolicy: z.string().optional().default('Bypass').describe('PowerShell执行策略'),
});

export type PowerShellInputType = z.infer<typeof PowerShellInputSchema>;

/**
 * PowerShellTool 输出模式
 */
export const PowerShellOutputSchema = z.object({
  output: z.string().describe('命令输出'),
  executionTime: z.number().int().nonnegative().describe('执行耗时（毫秒）'),
  exitCode: z.number().int().optional().describe('退出码'),
});

export type PowerShellOutputType = z.infer<typeof PowerShellOutputSchema>;

/**
 * 验证 PowerShellTool 输入
 */
export function validatePowerShellInput(input: unknown): PowerShellInputType {
  const result = PowerShellInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`PowerShell输入验证失败: ${errors}`);
  }
  return result.data;
}
