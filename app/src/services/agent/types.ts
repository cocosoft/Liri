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
 * Agent系统类型定义
 */

import type { HooksSettings } from '@modules/types';
import type { AgentMcpServerSpec } from './agentMcpServer';

export type AgentMemoryScope = 'user' | 'project' | 'local';

export type SettingSource =
  | 'userSettings'
  | 'projectSettings'
  | 'policySettings'
  | 'flagSettings'
  | 'plugin'
  | 'built-in';

export type AgentColorName =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'teal'
  | 'cyan'
  | 'indigo';

/**
 * 基础Agent定义
 */
export interface BaseAgentDefinition {
  agentType: string;
  whenToUse: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  mcpServers?: AgentMcpServerSpec[];
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
  pendingSnapshotUpdate?: { snapshotTimestamp: string };
  omitClaudeMd?: boolean;
}

/**
 * 内置Agent定义
 */
export interface BuiltInAgentDefinition extends BaseAgentDefinition {
  source: 'built-in';
  baseDir: 'built-in';
  callback?: () => void;
  getSystemPrompt: (params: { toolUseContext: any }) => string;
}

/**
 * 自定义Agent定义
 */
export interface CustomAgentDefinition extends BaseAgentDefinition {
  getSystemPrompt: () => string;
  source: Exclude<SettingSource, 'built-in' | 'plugin'>;
  filename?: string;
  baseDir?: string;
}

/**
 * 插件Agent定义
 */
export interface PluginAgentDefinition extends BaseAgentDefinition {
  getSystemPrompt: () => string;
  source: 'plugin';
  filename?: string;
  plugin: string;
}

/**
 * 所有Agent类型的联合类型
 */
export type AgentDefinition =
  | BuiltInAgentDefinition
  | CustomAgentDefinition
  | PluginAgentDefinition;

/**
 * 解析后的Agent（包含覆盖信息）
 */
export type ResolvedAgent = AgentDefinition & {
  overriddenBy?: string;
};

/**
 * Agent定义结果
 */
export interface AgentDefinitionsResult {
  activeAgents: AgentDefinition[];
  allAgents: AgentDefinition[];
  failedFiles?: Array<{ path: string; error: string }>;
  allowedAgentTypes?: string[];
}

/**
 * Agent运行时信息
 */
export interface AgentRuntimeInfo {
  agentType: string;
  source: SettingSource;
  startTime: number;
  memoryUsage?: number;
  lastActivity?: number;
}
