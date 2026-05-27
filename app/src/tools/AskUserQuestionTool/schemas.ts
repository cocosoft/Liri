import { z } from 'zod';

/**
 * AskUserQuestionTool 输入模式
 */
export const AskUserQuestionInputSchema = z.strictObject({
  question: z.string().min(1).max(500).describe('向用户提出的问题'),
  header: z
    .string()
    .min(1)
    .max(30)
    .describe('简短标签/标题（如 "Auth method", "Library"），显示为标签样式'),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(100).describe('选项显示文本'),
        description: z.string().min(1).max(300).describe('选项说明/解释'),
      })
    )
    .min(2)
    .max(4)
    .describe('选项列表（2-4 个选项），用户可选择其中一个或多个'),
  multiSelect: z.boolean().optional().describe('是否允许多选，默认为 false'),
});

/**
 * AskUserQuestionTool 输出模式
 */
export const AskUserQuestionOutputSchema = z.object({
  questionId: z.string().describe('问题唯一标识'),
  question: z.string().describe('问题内容'),
  answers: z.array(z.string()).describe('用户选择的答案列表'),
  timestamp: z.number().describe('提问时间戳'),
});

export type AskUserQuestionInput = z.infer<typeof AskUserQuestionInputSchema>;
export type AskUserQuestionOutput = z.infer<typeof AskUserQuestionOutputSchema>;

/**
 * 验证 AskUserQuestionTool 输入
 */
export function validateAskUserQuestionInput(input: unknown) {
  const result = AskUserQuestionInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `AskUserQuestionTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
