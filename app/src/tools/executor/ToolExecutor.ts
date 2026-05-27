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
 */
export const globalToolExecutor = createToolExecutor();

export type { ToolExecutionStats, ToolExecutionLog };
