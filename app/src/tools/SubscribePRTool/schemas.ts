import { z } from 'zod';

/**
 * PR 订阅事件类型
 */
const PREventEnum = z.enum(['opened', 'closed', 'merged', 'comment', 'review']);

/**
 * SubscribePRTool 输入模式
 */
export const SubscribePRInputSchema = z.strictObject({
  repo: z.string().min(1).describe('GitHub 仓库名称（如 "owner/repo"）'),
  events: z.array(PREventEnum).min(1).describe('要订阅的事件类型列表'),
  prNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('PR 编号，不提供则订阅所有 PR'),
});

/**
 * ⚠️ `SubscribePROutputSchema`（`{id, repo, prNumber?, events[], createdAt, active}`）已于 2026-09-29 删除（T6 分批处置 · 批次 4b）。
 *
 * 原因（实证）：该工具**定义在 `ToolFactory.ts:837-898` 的内联对象里**（其目录下 `SubscribePRTool.ts`
 * 只是辅助函数），`execute` 的 4 处出口全是 `{success, output: JSON.stringify(...)}` 形态 ——
 * **既无 `data` 也无 `result` 载荷**，结构化结果被序列化进 **`output` 字符串**
 * ⇒ 本 schema 描述的形态**在出口不存在**（第 ④ 族）。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export type SubscribePRInput = z.infer<typeof SubscribePRInputSchema>;

/**
 * 验证 SubscribePRTool 输入
 */
export function validateSubscribePRInput(input: unknown) {
  const result = SubscribePRInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `SubscribePRTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
