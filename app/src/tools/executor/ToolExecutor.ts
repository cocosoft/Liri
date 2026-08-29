/**
 * 工具执行器 — CC 兼容层
 *
 * 基于增强后的原始 ToolExecutor，提供全局单例 globalToolExecutor，
 * 与 tools/index.ts 等 CC 消费者兼容。
 */

import {
  ToolExecutor as OriginalToolExecutor,
  createToolExecutor,
} from '../ToolExecutor';
import type { ToolExecutionStats, ToolExecutionLog } from '../types/ToolTypes';

export { OriginalToolExecutor as ToolExecutor };

/**
 * 全局工具执行器实例
 * 惰性初始化：顶层 createToolExecutor() 会级联触发 GovernanceManager →
 * ToolHookManager，本模块可能在此链上被提前加载（TDZ 循环导入）。
 */
let _globalToolExecutor: OriginalToolExecutor | undefined;
function getGlobalToolExecutor(): OriginalToolExecutor {
  _globalToolExecutor ??= createToolExecutor();
  return _globalToolExecutor;
}
export const globalToolExecutor = new Proxy({} as OriginalToolExecutor, {
  get(_, prop: keyof OriginalToolExecutor) {
    const instance = getGlobalToolExecutor();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});

export type { ToolExecutionStats, ToolExecutionLog };
