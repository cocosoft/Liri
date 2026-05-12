/**
 * 默认工具策略
 * 允许所有工具使用（向后兼容）
 */

import type { Tool } from '../types/Tool';
import type { ToolPolicy, PolicyContext, PolicyResult } from './ToolPolicy';
import { allowResult } from './ToolPolicy';

export class DefaultToolPolicy implements ToolPolicy {
  readonly name = 'DefaultToolPolicy';

  evaluate(_tool: Tool, _context: PolicyContext): PolicyResult {
    void _tool;
    void _context;
    return allowResult(this.name);
  }

  evaluateBatch(tools: Tool[], _context: PolicyContext): PolicyResult[] {
    void _context;
    return tools.map(() => allowResult(this.name));
  }
}
