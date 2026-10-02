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

import type { ToolUseBlock } from '@modules/session/types/ToolUseBlock';
import { WRITE_TOOLS as SHARED_FILE_WRITE_TOOLS } from '@modules/query/tool-constants.js';

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
 *
 * 2026-09-26（P3-2 顺查项③ 第 5 处，运行时判据坐实后修复）：
 * 原清单沿用**外部（CC）命名**（`Read`/`Glob`/`Grep`/`ToolSearch`/`TaskGet`…），
 * 而消费点 [Partitioner.ts:35](Partitioner.ts) 传入的 `block.name` 是**模型调用名** ——
 * 本仓即**真实注册名**（`file_read`/`grep`/`glob`…）⇒ 原清单**永不命中**，
 * `isReadOnlyTool()` 恒 false ⇒ 只读工具永不被判为"可并发"（并发分区实质失效）。
 * 现改为真实注册名（判据来自各工具类的 `name`，并由
 * `tests/tools/orchestration/toolCallPartitionerToolNames.test.ts` 守卫）。
 */
export const READ_ONLY_TOOLS = new Set([
  'file_read',
  'glob',
  'grep',
  'lsp',
  'get_task_list',
]);

/**
 * 必须**串行执行**的工具集合（并发分区用：这些工具之间不得并行）。
 *
 * 取值 = **共享的文件写类清单** ∪ {`bash`}：`bash` 无"按文件读写"语义（故不在共享清单内），
 * 但它会改动工作区状态 ⇒ 绝不能与其他调用并发。
 *
 * 裁定①（2026-09-26 用户裁定）：本集合与 `query/tool-constants` 的"文件 IO 写类"、
 * `promptSuggestion` 的"推测执行写类"**语义不同 ⇒ 不硬并**，只**共享取值 + 各自命名**。
 */
export const SERIALIZING_TOOLS = new Set([...SHARED_FILE_WRITE_TOOLS, 'bash']);

/**
 * 搜索工具集合
 *
 * 2026-09-29（P2-3）：移除 `'file_search'` —— **非注册名**（仅存在于 `ToolFactory.getAllBaseTools()`
 * 死路径，台账 N-27）⇒ 属"永不命中的假覆盖"。
 */
export const SEARCH_TOOLS = new Set(['grep', 'glob']);

/**
 * 判断是否为只读工具
 * @param toolName 工具名称
 * @returns 是否为只读工具
 */
export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

/**
 * 判断该工具是否**必须串行执行**（即不得与其他工具调用并发）。
 *
 * 命名说明：原为 `isWriteTool`，但集合含 `bash`（并非文件写工具）⇒ 旧名与语义不符；
 * 2026-09-26（裁定①）随集合改名一并更正为语义名。
 * @param toolName 工具名称
 * @returns 是否需要串行（true = 不可并发）
 */
export function needsSerialExecution(toolName: string): boolean {
  return SERIALIZING_TOOLS.has(toolName);
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
