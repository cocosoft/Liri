/**
 * 出参契约运行期校验（纯函数；P1-3 A 档 2026-09-28，P2-1 2026-11-22 下沉 infra）
 *
 * 为什么在 infra：所有执行入口（ToolExecutor / ToolRegistry / LRO 直调）都要用，
 * 而 app 侧 `@modules/tools` 对 LRO 是**禁止直接 import 的模块**（module-registry 规则）。
 * 放在工具契约旁边（与 `Tool` / `ToolResult` 同目录），各入口只依赖 infra。
 *
 * 语义（**保守**）：
 * - 未声明 `outputSchema` ⇒ `null`（不校验，行为完全不变）；
 * - `data == null` ⇒ `null`（无载荷不校验）；
 * - 通过 ⇒ `null`；失败 / schema 自身抛错 ⇒ 详情文本（调用方记录，**不阻断执行**）。
 */
import type { Tool, ToolResult } from './Tool';

export function validateToolOutputShape(
  tool: Pick<Tool, 'name' | 'outputSchema'>,
  result: ToolResult
): string | null {
  const schema = tool.outputSchema;
  if (!schema) return null;

  // 载荷字段只看 `data`（主载荷）。B2-b（2026-09-30）已撤除 `result.data ?? result.result`
  // 的过渡回退：全仓再无"手写 ToolResult 且载荷在 result"的写入点。
  const payload = result.data;
  if (payload == null) return null;

  let parsed: { success: boolean; error?: unknown };
  try {
    parsed = schema.safeParse(payload);
  } catch (error) {
    return `outputSchema 执行异常：${String(error)}`;
  }
  if (parsed.success) return null;
  // 不用状态词汇 `'unknown'` 作占位（`lint:state-ratchet` 只认已登记词汇，新增出现点须报备）
  if (parsed.error instanceof Error) return parsed.error.message;
  if (parsed.error != null) return String(parsed.error);
  return 'outputSchema 校验失败（未提供错误详情）';
}
