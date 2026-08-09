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
 * AI代理模型类型定义
 */

import { AIModelType } from '@modules/ai';
import type { ParsedToolCall } from '@modules/ai/models/types';
import type { HooksSettings } from '@modules/types';
import type { SkillLifecycleManager } from '@modules/tools/AgentTool/SkillLifecycleManager';

/**
 * 代理状态
 */
export enum AgentState {
  IDLE = 'idle',
  BUSY = 'busy',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
}

/**
 * 代理任务
 */
export interface AgentTask {
  id: string;
  name: string;
  description: string;
  input: Record<string, unknown>;
  expectedOutput?: Record<string, unknown>;
  tools?: AgentTool[];
  deadline?: number;
  priority?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 代理工具
 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    params: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
}

/**
 * 代理响应
 */
export interface AgentResponse {
  id: string;
  taskId: string;
  content: string;
  result?: Record<string, unknown>;
  status: AgentState;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timestamp: number;
  finishReason?: string;
  toolCalls?: ParsedToolCall[];
  metadata?: Record<string, unknown>;
}

/**
 * 代理策略
 */
export interface AgentStrategy {
  name: string;
  description: string;
  execute(task: AgentTask, context: AgentContext): Promise<AgentResponse>;
  buildSystemPrompt?(task: AgentTask, context: AgentContext): string;
  buildUserMessage?(task: AgentTask): string;
}

/**
 * 代理上下文
 */
export interface AgentContext {
  tools: AgentTool[];
  memory: AgentMemory;
  model: AIModelType;
  temperature: number;
  maxTokens: number;
  timeout: number;
  taskId?: string;
  agentId?: string;
  promptMode?: 'full' | 'minimal' | 'none';
  metadata?: Record<string, unknown>;
}

/**
 * 代理内存
 */
export interface AgentMemory {
  add(key: string, value: unknown, tags?: string[]): void;
  get(key: string): unknown;
  delete(key: string): void;
  clear(): void;
  getAll(): Record<string, unknown>;
  save(): void;
  load(): void;
  scan(
    predicate: (key: string, value: unknown, item: unknown) => boolean
  ): Record<string, unknown>;
  searchByTag(tag: string): Record<string, unknown>;
  filterByScope(scope: AgentMemoryScope): Record<string, unknown>;
  getStats(): {
    totalItems: number;
    oldestItem: number | null;
    newestItem: number | null;
    averageAge: number | null;
  };
  setMaxAge(milliseconds: number): void;
  setMaxSize(size: number): void;
  getScope(): AgentMemoryScope;
}

/**
 * 代理配置
 */
export interface AgentConfig {
  model: AIModelType;
  temperature: number;
  maxTokens: number;
  timeout: number;
  memoryPath: string;
  defaultStrategy: string;
  promptMode?: 'full' | 'minimal' | 'none';
  tools: AgentTool[];
  curatorConfig?: {
    enabled: boolean;
    intervalHours: number;
    minIdleHours: number;
    staleAfterDays: number;
    archiveAfterDays: number;
  };
}

/**
 * 代理服务接口
 */
export interface AgentService {
  createAgent(config: Partial<AgentConfig>): AIAgent;
  getAgent(agentId: string): AIAgent | undefined;
  listAgents(): AIAgent[];
  deleteAgent(agentId: string): boolean;
  updateAgent(
    agentId: string,
    config: Partial<AgentConfig>
  ): AIAgent | undefined;
  setDefaultModel(model: AIModelType): void;
  getDefaultModel(): AIModelType;
  updateConfig(config: Partial<AgentConfig>): void;
  getConfig(): AgentConfig;
}

/**
 * AI代理接口
 */
export interface AIAgent {
  id: string;
  name: string;
  config: AgentConfig;
  state: AgentState;
  execute(task: AgentTask): Promise<AgentResponse>;
  stream(task: AgentTask): AsyncGenerator<AgentResponse>;
  pause(): void;
  resume(): void;
  stop(): void;
  cancel(): void;
  getState(): AgentState;
  getInfo(): {
    id: string;
    name: string;
    state: AgentState;
    model: string;
    strategy: string;
    toolCount: number;
  };
  updateConfig(config: Partial<AgentConfig>): void;
  serialize(): unknown;
  getSkillLifecycleManager(): SkillLifecycleManager | null;
}

/**
 * 代理历史记录
 */
export interface AgentHistory {
  taskId: string;
  agentId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: AgentState;
  error?: string;
  timestamp: number;
  duration: number;
}

/**
 * Agent来源类型
 */
export type AgentSource =
  | 'built-in'
  | 'user'
  | 'project'
  | 'local'
  | 'managed'
  | 'plugin';

/**
 * Agent内存作用域
 */
export type AgentMemoryScope = 'user' | 'project' | 'local';

/**
 * Agent颜色名称
 */
export type AgentColorName =
  | 'blue'
  | 'green'
  | 'red'
  | 'yellow'
  | 'purple'
  | 'cyan'
  | 'orange'
  | 'pink';

/**
 * Agent配置详情
 */
export interface AgentConfigDetails {
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * 基础Agent定义
 */
export interface BaseAgentDefinition {
  agentType: string;
  whenToUse: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  mcpServers?: unknown[];
  hooks?: HooksSettings;
  color?: AgentColorName;
  model?: string;
  effort?: number | string;
  permissionMode?: string;
  maxTurns?: number;
  filename?: string;
  baseDir?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  requiredMcpServers?: string[];
  background?: boolean;
  initialPrompt?: string;
  memory?: AgentMemoryScope | { enabled: boolean; retentionDays?: number };
  isolation?: 'worktree' | 'remote';
  omitClaudeMd?: boolean;
  source: AgentSource;
  getSystemPrompt: () => string;
  name?: string;
  version?: string;
  config?: AgentConfigDetails;
}

/**
 * 内置Agent定义
 */
export interface BuiltInAgentDefinition extends BaseAgentDefinition {
  source: 'built-in';
  baseDir: 'built-in';
  callback?: () => void;
}

/**
 * 自定义Agent定义
 */
export interface CustomAgentDefinition extends BaseAgentDefinition {
  source: Exclude<AgentSource, 'built-in' | 'plugin'>;
  filename?: string;
  baseDir?: string;
}

/**
 * 插件Agent定义
 */
export interface PluginAgentDefinition extends BaseAgentDefinition {
  source: 'plugin';
  filename?: string;
  plugin: string;
}

/**
 * Agent定义联合类型
 */
export type AgentDefinition =
  | BuiltInAgentDefinition
  | CustomAgentDefinition
  | PluginAgentDefinition;

/**
 * Agent定义结果
 */
export interface AgentDefinitionsResult {
  activeAgents: AgentDefinition[];
  allAgents: AgentDefinition[];
  failedFiles?: Array<{ path: string; error: string }>;
  allowedAgentTypes?: string[];
}
