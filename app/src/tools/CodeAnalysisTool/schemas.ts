import { z } from 'zod';

/**
 * CodeAnalysisTool 输入模式
 */
export const CodeAnalysisInputSchema = z.strictObject({
  target: z.string().min(1).describe('分析目标路径'),
  analysisType: z
    .enum(['structure', 'complexity', 'dependencies', 'quality'])
    .describe(
      '分析类型：structure 结构分析，complexity 复杂度分析，dependencies 依赖分析，quality 质量分析'
    ),
  recursive: z.boolean().optional().describe('是否递归分析子目录，默认为 true'),
  extensions: z
    .array(z.string())
    .optional()
    .describe('文件扩展名过滤，如 [".ts", ".js"]'),
  maxFiles: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .describe('最大分析文件数，默认为 100'),
});

/**
 * CodeAnalysisTool 输出模式
 */
export const CodeAnalysisOutputSchema = z.object({
  analysis: z
    .object({
      type: z.string().describe('分析类型'),
      stats: z.record(z.any()).describe('分析统计数据'),
      details: z.any().optional().describe('分析详细信息'),
    })
    .describe('分析结果'),
  filesAnalyzed: z.number().describe('已分析的文件数'),
  analysisTime: z.number().describe('分析耗时（毫秒）'),
});

export type CodeAnalysisInput = z.infer<typeof CodeAnalysisInputSchema>;
export type CodeAnalysisOutput = z.infer<typeof CodeAnalysisOutputSchema>;

/**
 * U-03（2026-10-19）：**模型可见出参结构**（JSON Schema），与 `CodeAnalysisOutputSchema`
 * 逐字段对齐；模型侧不引入 zod ⇒ 手写等价结构。改 zod 时须同步本对象
 * （`toolOutputJsonSchema.test.ts` 做键集一致性断言）。
 */
export const CodeAnalysisOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    analysis: {
      type: 'object',
      description: '分析结果',
      properties: {
        type: { type: 'string', description: '分析类型' },
        stats: { type: 'object', description: '分析统计数据' },
        details: { description: '分析详细信息（结构随分析类型变化）' },
      },
      required: ['type', 'stats'],
    },
    filesAnalyzed: { type: 'number', description: '已分析的文件数' },
    analysisTime: { type: 'number', description: '分析耗时（毫秒）' },
  },
  required: ['analysis', 'filesAnalyzed', 'analysisTime'],
};

/**
 * 验证 CodeAnalysisTool 输入
 */
export function validateCodeAnalysisInput(input: unknown) {
  const result = CodeAnalysisInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `CodeAnalysisTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
