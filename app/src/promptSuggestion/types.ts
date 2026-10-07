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
 * Prompt Suggestion类型定义
 */

import type { ToolName } from '@modules/constants/toolNames.generated';

export type PromptVariant = 'user_intent' | 'stated_intent';

export type SuggestionOutcome = 'accepted' | 'ignored';

export type AcceptMethod = 'tab' | 'enter';

export type SuggestionSource = 'cli' | 'sdk';

export interface SuggestionHistory {
  id?: number;
  suggestion: string;
  prompt_id: string | null;
  shown_at: number;
  accepted_at: number | null;
  outcome: SuggestionOutcome;
  accept_method: AcceptMethod | null;
  time_to_accept_ms: number | null;
  time_to_ignore_ms: number | null;
  time_to_first_keystroke_ms: number | null;
  similarity: number | null;
  session_id: string | null;
  created_at: number;
}

export interface SuggestionConfig {
  prompt_suggestion_enabled: boolean;
  suggestion_max_words: number;
  suggestion_max_length: number;
  speculation_enabled: boolean;
}

export interface PromptSuggestionState {
  text: string;
  promptId: PromptVariant;
  shownAt: number;
  acceptedAt: number;
  generationRequestId: string | null;
}

export interface SuggestionSuppressReason {
  reason: string;
  suggestion?: string;
  promptId?: PromptVariant;
  source?: SuggestionSource;
}

export const DEFAULT_SUGGESTION_CONFIG: SuggestionConfig = {
  prompt_suggestion_enabled: true,
  suggestion_max_words: 12,
  suggestion_max_length: 100,
  speculation_enabled: true,
};

export const SUGGESTION_PROMPT = `[建议模式：预测用户接下来可能自然输入到 Liri 的内容。]

首先：查看用户最近的消息和最初的请求。

你的任务是预测"他们"会输入什么——而不是你认为他们应该做什么。

检验标准：他们会不会想"我正打算输入这个"？

示例：
用户说"修复这个 bug 并运行测试"，bug 已修复 → "运行测试"
代码写完后 → "试试看"
Liri 给出若干选项 → 根据对话内容，建议用户最可能选的那个
Liri 询问是否继续 → "好" 或 "继续"
任务完成、有明显的后续动作 → "提交这个" 或 "推送一下"
出错或误解之后 → 保持沉默（让对方自行评估/纠正）

要具体："运行测试" 优于 "继续"。

绝不建议：
- 评价性内容（"看起来不错"、"谢谢"）
- 提问（"那……呢？"）
- Liri 口吻（"我来……"、"我会……"、"这里是……"）
- 用户没有问过的新想法
- 多个句子

如果下一步从用户所说的话里并不明显，就保持沉默。

格式：2-12 个词，匹配用户的风格。或者不输出。

只回复建议本身，不要引号或解释。`;

export const SUGGESTION_PROMPTS: Record<PromptVariant, string> = {
  user_intent: SUGGESTION_PROMPT,
  stated_intent: SUGGESTION_PROMPT,
};

/**
 * 手动输入建议类型
 */

export type SuggestionType =
  | 'command'
  | 'file'
  | 'directory'
  | 'agent'
  | 'shell'
  | 'custom-title'
  | 'slack-channel'
  | 'none';

export interface SuggestionItem {
  id: string;
  displayText: string;
  tag?: string;
  description?: string;
  metadata?: unknown;
  color?: string;
}

export interface FileSuggestionSource {
  type: 'file';
  displayText: string;
  description?: string;
  path: string;
  filename: string;
  score?: number;
}

export interface McpResourceSuggestionSource {
  type: 'mcp_resource';
  displayText: string;
  description: string;
  server: string;
  uri: string;
  name: string;
}

export interface AgentSuggestionSource {
  type: 'agent';
  displayText: string;
  description: string;
  agentType: string;
  color?: string;
}

export interface CommandSuggestionSource {
  type: 'command';
  displayText: string;
  description?: string;
  commandName: string;
  partKey?: string;
  aliasKey?: string;
}

export type UnifiedSuggestionSource =
  | FileSuggestionSource
  | McpResourceSuggestionSource
  | AgentSuggestionSource
  | CommandSuggestionSource;

export interface AgentDefinition {
  agentType: string;
  whenToUse: string;
}

export interface ServerResource {
  uri: string;
  name: string;
  description: string;
}

export const MAX_UNIFIED_SUGGESTIONS = 15;
export const DESCRIPTION_MAX_LENGTH = 60;

/**
 * Speculation超前执行类型
 * 重新从核心状态模块导出
 */
export type { SuggestionSpeculationStatus as SpeculationStatus } from '@modules/appState/AppState.js';
export type { SuggestionSpeculationResult as SpeculationResult } from '@modules/appState/AppState.js';
export type { SuggestionSpeculationState as SpeculationState } from '@modules/appState/AppState.js';
export { IDLE_SUGGESTION_SPECULATION_STATE as IDLE_SPECULATION_STATE } from '@modules/appState/AppState.js';

export const MAX_SPECULATION_TURNS = 20;
export const MAX_SPECULATION_MESSAGES = 100;

/**
 * 推测执行**不得预跑**的写类工具（语义 = 推测执行的安全边界）。
 *
 * **取值共享**自 `query/tool-constants.ts`（本仓工具真实名的事实来源），本处不再写死字面量。
 * 裁定①（2026-09-26 用户裁定）：本清单与 `tools/orchestration` 的"必须串行"、
 * `query/tool-constants` 的"文件 IO 读写"**语义不同 ⇒ 不硬并**，但**共享取值 + 各自命名**。
 *
 * 历史（2026-09-26 修复 P3-2 顺查项③）：原清单为 CC 名 `Edit`/`Write`/`NotebookEdit` ⇒ 本仓恒不命中；
 * 且本仓无 `NotebookEdit`，其真实对应是 `notebook`（已含于共享清单）。
 */
export { WRITE_TOOLS as SPECULATION_WRITE_TOOLS } from '@modules/query/tool-constants.js';

/**
 * 安全只读工具（同上修复）。
 *
 * 映射依据 = 真实名：`file_read` / `glob` / `grep` / `lsp` / `get_task_list`。
 * ⚠️ 原清单里的 `ToolSearch` / `TaskGet` / `TaskList` **在本仓不存在**：取最接近的真实只读工具
 * （`get_task_list`）；这是**语义近似**，已在台账注明。
 *
 * 2026-09-29（P2-3/T2）：① 移除 `'file_search'` —— **不是注册名**（仅在 `ToolFactory.getAllBaseTools()`
 * 死路径 + 无 loader 引用的 `FileSearchTool`，台账 N-27）⇒ "永不命中的假覆盖"；
 * ② 移除 `'view_tasks'`（2026-09-29 台账 **D-34**）：该**类已删除**（与活工具 `get_task_list` 职责重复）
 * ⇒ 它不再是"待注册"，保留只会成为新的漂移。
 *
 * 2026-09-29（D-34 收尾）：移除 `view_tasks` 后本清单**已全部是注册名** ⇒ 按 T2 同一手法补
 * `as const satisfies readonly ToolName[]` **编译期校验**（拼错 / 改名未同步 ⇒ `typecheck` 报错）；
 * **导出类型仍为 `Set<string>`** ⇒ 零消费方改动。
 */
const SAFE_READ_ONLY_TOOL_NAMES = [
  'file_read',
  'glob',
  'grep',
  'lsp',
  'get_task_list',
] as const satisfies readonly ToolName[];
export const SAFE_READ_ONLY_TOOLS = new Set<string>(SAFE_READ_ONLY_TOOL_NAMES);
