/**
 * Agent系统类型定义
 */

import type { HooksSettings } from '../../utils/settings/types';
import type { PermissionMode } from '../../utils/permissions/PermissionMode';
import type { EffortValue } from '../../utils/effort';
import type { AgentMcpServerSpec } from './agentMcpServer';

export type AgentMemoryScope = 'user' | 'project' | 'local';

export type SettingSource = 'userSettings' | 'projectSettings' | 'policySettings' | 'flagSettings' | 'plugin' | 'built-in';

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
  effort?: EffortValue;
  permissionMode?: PermissionMode;
  maxTurns?: number;
  filename?: string;
  baseDir?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  requiredMcpServers?: string[];
  background?: boolean;
  initialPrompt?: string;
  memory?: AgentMemoryScope;
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
  getSystemPrompt: (params: {
    toolUseContext: any;
  }) => string;
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
export interface ResolvedAgent extends AgentDefinition {
  overriddenBy?: string;
}

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
