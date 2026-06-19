/**
 * 治理闭环类型定义
 * 定义治理闭环的类型、接口和工具执行上下文
 */
import { Tool } from '@modules/tools/types/Tool';
import { PermissionDecision } from '@modules/permission/types/PermissionDecision';
import { ToolHookResult } from '@modules/hooks/types/ToolHooks';
import {
  SandboxCheckResult,
  SandboxViolationEvent,
} from '@modules/sandbox/SandboxTypes';

/**
 * 工具执行状态
 */
export type ToolExecutionStatus =
  | 'pending'
  | 'validating'
  | 'checking_permissions'
  | 'executing_hooks'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * 工具执行事件类型
 */
export type GovernanceEventType =
  | 'tool_discovered'
  | 'tool_validated'
  | 'permission_check'
  | 'pre_hook_execution'
  | 'tool_execution'
  | 'post_hook_execution'
  | 'tool_completed'
  | 'tool_failed'
  | 'sandbox_violation'
  | 'governance_audit';

/**
 * 治理事件
 */
export interface GovernanceEvent {
  type: GovernanceEventType;
  toolName: string;
  toolUseId: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  permissionMode: string;
  abortSignal?: AbortSignal;
  messages?: unknown[];
}

/**
 * 治理检查结果
 */
export interface GovernanceCheckResult {
  allowed: boolean;
  reason?: string;
  source: 'permission' | 'hook' | 'sandbox' | 'validation';
  details?: {
    permissionResult?: PermissionDecision;
    hookResult?: ToolHookResult;
    sandboxResult?: SandboxCheckResult;
  };
}

/**
 * 治理执行结果
 */
export interface GovernanceExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  exitCode?: number;
  durationMs: number;
  events: GovernanceEvent[];
  violations: SandboxViolationEvent[];
  governanceCheck: GovernanceCheckResult;
  toolName?: string;
  toolUseId?: string;
  executionId?: string;
  executionTime?: number;
}

/**
 * 治理配置
 */
export interface GovernanceConfig {
  enabled: boolean;
  enforcePermission: boolean;
  enforceSandbox: boolean;
  enforceHooks: boolean;
  enforceFeatureFlags: boolean;
  maxExecutionTimeMs: number;
  allowParallelExecution: boolean;
}

/**
 * 创建默认治理配置
 */
export function createDefaultGovernanceConfig(): GovernanceConfig {
  return {
    enabled: true,
    enforcePermission: true,
    enforceSandbox: false,
    enforceHooks: true,
    enforceFeatureFlags: true,
    maxExecutionTimeMs: 300000,
    allowParallelExecution: true,
  };
}

/**
 * 治理状态
 */
export interface GovernanceState {
  config: GovernanceConfig;
  activeExecutions: Map<string, ToolExecutionStatus>;
  completedExecutions: Map<string, GovernanceExecutionResult>;
  pendingPermissions: Map<string, unknown>;
}

/**
 * 治理统计
 */
export interface GovernanceStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  cancelledExecutions: number;
  pendingExecutions: number;
  averageExecutionTimeMs: number;
  violationCount: number;
}
