/**
 * 默认工具策略管道（A2-a，2026-10-18）。
 *
 * 单一实例供**所有执行收口**共享：
 * - `ToolRegistry.executeTool`（主聊天路径：ChatManager → ToolExecutionService → Registry）
 * - `ToolManager.executeTool`（CLI / CoreAPI / 其他路径）
 *
 * 默认只装 `GuestReadOnlyPolicy`：
 * - `userRole !== 'guest'` ⇒ 全部放行（既有行为零变化）；
 * - `userRole === 'guest'` ⇒ 只允许 `TOOL_EFFECTS.sideEffect === 'none'` 的只读工具。
 *
 * ⚠️ 这是**策略层**，不替代 `permission` / sandbox / PathGuard；后续 A-3（空管道 fail-closed）
 * 与更多策略可在此追加，但必须保持默认 owner 行为不变。
 */

import { GuestReadOnlyPolicy } from './GuestReadOnlyPolicy';
import { ToolPolicyPipeline } from './ToolPolicyPipeline';

let defaultPipeline: ToolPolicyPipeline | null = null;

/** 获取共享的默认策略管道（懒初始化，避免模块环）。 */
export function getDefaultToolPolicyPipeline(): ToolPolicyPipeline {
  if (!defaultPipeline) {
    defaultPipeline = new ToolPolicyPipeline([new GuestReadOnlyPolicy()]);
  }
  return defaultPipeline;
}

/** 替换默认管道（测试 / 灰度用；生产默认不调用）。 */
export function setDefaultToolPolicyPipeline(
  pipeline: ToolPolicyPipeline
): void {
  defaultPipeline = pipeline;
}

/** 测试隔离：恢复默认 `[GuestReadOnlyPolicy]`。 */
export function resetDefaultToolPolicyPipelineForTest(): void {
  defaultPipeline = null;
}
