/**
 * 工具编排类型定义
 * 基于CC源码 cc_code/backend/services/tools/toolOrchestration.ts 实现
 */

import type { ToolUseBlock } from '@modules/chat/types/ToolUseBlock';

/**
 * 工具调用分区
 */
export interface ToolCallPartition {
  /** 是否并发安全 */
  isConcurrencySafe: boolean;
  /** 工具调用块列表 */
  blocks: ToolUseBlock[];
}

/**
 * 消息更新
 */
export interface MessageUpdate {
  /** 消息 */
  message?: any;
  /** 新上下文 */
  newContext: any;
  /** 上下文修改器 */
  contextModifier?: ContextModifier;
}

/**
 * 上下文修改器
 */
export type ContextModifier = {
  toolUseID: string;
  modifyContext: (context: any) => any;
};

/**
 * 只读工具集合
 * 这些工具可以安全并发执行
 */
export const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'ListMcpResources',
  'ReadMcpResource',
  'ToolSearch',
  'TaskGet',
  'TaskList',
  'Time',
]);

/**
 * 写入工具集合
 * 这些工具必须串行执行
 */
export const WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'Bash',
  'PowerShell',
  'TaskCreate',
  'TaskUpdate',
  'TaskStop',
  'Skill',
  'Agent',
  'TodoWrite',
]);

/**
 * 搜索工具集合
 */
export const SEARCH_TOOLS = new Set([
  'Grep',
  'Glob',
  'WebSearch',
  'ToolSearch',
]);

/**
 * 判断是否为只读工具
 * @param toolName 工具名称
 * @returns 是否为只读工具
 */
export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

/**
 * 判断是否为写入工具
 * @param toolName 工具名称
 * @returns 是否为写入工具
 */
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

/**
 * 判断是否为搜索工具
 * @param toolName 工具名称
 * @returns 是否为搜索工具
 */
export function isSearchTool(toolName: string): boolean {
  return SEARCH_TOOLS.has(toolName);
}

/**
 * 判断工具是否并发安全
 * @param toolName 工具名称
 * @returns 是否并发安全
 */
export function isConcurrencySafe(toolName: string): boolean {
  return isReadOnlyTool(toolName) || isSearchTool(toolName);
}
