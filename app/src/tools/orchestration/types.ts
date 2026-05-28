// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 工具编排类型定义
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
