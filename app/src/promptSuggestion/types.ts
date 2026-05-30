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

export const SUGGESTION_PROMPT = `[SUGGESTION MODE: Suggest what the user might naturally type next into Liri.]

FIRST: Look at the user's recent messages and original request.

Your job is to predict what THEY would type - not what you think they should do.

THE TEST: Would they think "I was just about to type that"?

EXAMPLES:
User asked "fix the bug and run tests", bug is fixed → "run the tests"
After code written → "try it out"
Liri offers options → suggest the one the user would likely pick, based on conversation
Liri asks to continue → "yes" or "go ahead"
Task complete, obvious follow-up → "commit this" or "push it"
After error or misunderstanding → silence (let them assess/correct)

Be specific: "run the tests" beats "continue".

NEVER SUGGEST:
- Evaluative ("looks good", "thanks")
- Questions ("what about...?")
- Liri-voice ("Let me...", "I'll...", "Here's...")
- New ideas they didn't ask about
- Multiple sentences

Stay silent if the next step isn't obvious from what the user said.

Format: 2-12 words, match the user's style. Or nothing.

Reply with ONLY the suggestion, no quotes or explanation.`;

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
export type { SuggestionSpeculationStatus as SpeculationStatus } from '@modules/state/AppState.js';
export type { SuggestionSpeculationResult as SpeculationResult } from '@modules/state/AppState.js';
export type { SuggestionSpeculationState as SpeculationState } from '@modules/state/AppState.js';
export { IDLE_SUGGESTION_SPECULATION_STATE as IDLE_SPECULATION_STATE } from '@modules/state/AppState.js';

export const MAX_SPECULATION_TURNS = 20;
export const MAX_SPECULATION_MESSAGES = 100;

export const WRITE_TOOLS = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
  'notebook',
]);
export const SAFE_READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'ToolSearch',
  'LSP',
  'TaskGet',
  'TaskList',
]);
