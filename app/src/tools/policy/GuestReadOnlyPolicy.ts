/**
 * GuestReadOnlyPolicy — guest 角色只读策略（A2-a，2026-10-18）。
 *
 * 判定依据是**工具效果声明**（`TOOL_EFFECTS`，唯一事实源），不是工具名字符串：
 * - `sideEffect === 'none'` ⇒ 只读 ⇒ 允许；
 * - `sideEffect === 'local' | 'external'` ⇒ 有副作用 ⇒ 拒绝；
 * - 未声明效果（MCP / 插件 / 未知工具）⇒ **保守拒绝**（fail-closed）。
 *
 * 仅当 `PolicyContext.userRole === 'guest'` 时生效；owner/operator/未声明角色
 * 一律放行（保持既有行为，零回归）。
 *
 * 说明：策略层不替代 `permission` / sandbox / PathGuard —— 它只做「角色维度的工具面裁剪」。
 */

import type { Tool } from '../types/Tool';
import { TOOL_EFFECTS } from '../toolEffects';
import type { ToolName } from '../../constants/toolNames.generated';
import {
  allowResult,
  denyResult,
  type PolicyContext,
  type PolicyResult,
  type ToolPolicy,
} from './ToolPolicy';

export class GuestReadOnlyPolicy implements ToolPolicy {
  readonly name = 'GuestReadOnlyPolicy';

  evaluate(tool: Tool, context: PolicyContext): PolicyResult {
    if (context.userRole !== 'guest') {
      return allowResult(this.name);
    }

    const effect = TOOL_EFFECTS[tool.name as ToolName];
    if (!effect) {
      return denyResult(
        this.name,
        `guest 只读：未知工具 ${tool.name} 无效果声明，保守拒绝`
      );
    }
    if (effect.sideEffect !== 'none') {
      return denyResult(
        this.name,
        `guest 只读：${tool.name} 的副作用为 ${effect.sideEffect}`
      );
    }
    return allowResult(this.name);
  }

  evaluateBatch(tools: Tool[], context: PolicyContext): PolicyResult[] {
    return tools.map((tool) => this.evaluate(tool, context));
  }
}
