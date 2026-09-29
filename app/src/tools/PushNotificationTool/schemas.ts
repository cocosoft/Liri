import { z } from 'zod';

/**
 * PushNotificationTool 输入模式
 */
export const PushNotificationInputSchema = z.strictObject({
  title: z.string().min(1).describe('通知标题'),
  body: z.string().min(1).describe('通知正文内容'),
  url: z.string().optional().describe('关联链接 URL'),
});

export type PushNotificationInput = z.infer<typeof PushNotificationInputSchema>;

/**
 * ⚠️ 本文件原有的 `PushNotificationSchema` + `PushNotificationOutputSchema`（`{notification}`）
 * 已于 2026-09-29 删除（T6 分批处置 · 批次 4a）。
 *
 * 原因（实证）：该工具**定义在 `ToolFactory.createPushNotificationTool()`（`ToolFactory.ts:732-831`）
 * 的内联对象里**（不在本目录；本目录的 `PushNotificationTool.ts` 只是 helper 模块），
 * 其 `execute` 返回的是 `{success, output}` —— **既无 `data` 也无 `result` 载荷**，
 * 结构化结果被 `JSON.stringify` 塞进 **`output` 字符串**（如 `{ success: true, output: JSON.stringify(n) }`）
 * ⇒ 本 schema 描述的形态**在出口不存在**；且校验只认 `data`/`result` 两个**载荷字段**，`output` 不在其列
 * （它是**人类可读文本**字段，把字符串拿去校验必然误报）⇒ 声明无意义。
 *
 * ⚠️ **另注（同类漂移）**：本文件的**入参** schema（`{title, body, url}`）与工具实际的 `action`
 * 参数（`send`/`list`/`unread`/`mark_read`/`mark_all_read`/`clear`）**完全不同**（D-7 同类，入参侧**未动**）。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * 验证 PushNotificationTool 输入
 */
export function validatePushNotificationInput(input: unknown) {
  const result = PushNotificationInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `PushNotificationTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
