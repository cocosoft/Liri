/**
 * 工具Hook类型定义
 */
import { PermissionMode } from '@modules/permission';
import { PermissionBehavior } from '@modules/permission/types/PermissionRule';

/**
 * PreToolUse Hook输入
 */
export interface PreToolUseHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  totp_code?: string;
}

/**
 * PostToolUse Hook输入
 */
export interface PostToolUseHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  tool_output: unknown;
}

/**
 * PostToolUseFailure Hook输入
 */
export interface PostToolUseFailureHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
}

/**
 * 工具Hook上下文
 */
export interface ToolHookContext {
  toolName: string;
  toolUseID: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  permissionMode: PermissionMode;
  abortSignal?: AbortSignal;
}

/**
 * 工具Hook阻塞错误
 */
export interface HookBlockingError {
  blockingError: string;
  command: string;
}

/**
 * 工具Hook权限请求结果
 */
export type ToolHookPermissionRequestResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
    }
  | {
      behavior: 'deny';
      message?: string;
      interrupt?: boolean;
    };

/**
 * 工具Hook结果
 */
export interface ToolHookResult {
  message?: string;
  systemMessage?: string;
  blockingError?: HookBlockingError;
  outcome: 'success' | 'blocking' | 'non_blocking_error' | 'cancelled';
  output?: string;
  error?: string;
  exitCode?: number;
  preventContinuation?: boolean;
  stopReason?: string;
  permissionBehavior?: PermissionBehavior | 'passthrough';
  hookPermissionDecisionReason?: string;
  additionalContext?: string;
  updatedInput?: Record<string, unknown>;
  updatedToolOutput?: unknown;
  permissionRequestResult?: ToolHookPermissionRequestResult;
  retry?: boolean;
}

/**
 * 聚合工具Hook结果
 */
export interface AggregatedToolHookResult {
  message?: string;
  blockingErrors?: HookBlockingError[];
  preventContinuation?: boolean;
  stopReason?: string;
  hookPermissionDecisionReason?: string;
  permissionBehavior?: PermissionBehavior | 'passthrough';
  additionalContexts?: string[];
  updatedInput?: Record<string, unknown>;
  updatedToolOutput?: unknown;
  permissionRequestResult?: ToolHookPermissionRequestResult;
  retry?: boolean;
}

/**
 * 工具Hook执行选项
 */
export interface ToolHookExecutionOptions {
  timeoutMs?: number;
  requestPrompt?: (
    request: string,
    options: { key: string; label: string; description?: string }[]
  ) => Promise<string>;
  toolUseSummary?: string;
  output?: unknown;
  error?: string;
}

/**
 * PreToolUse Hook解析结果
 */
export type PreToolUseHookYield =
  | { type: 'message'; message: string }
  | {
      type: 'hookPermissionResult';
      permissionBehavior: PermissionBehavior | 'passthrough';
      updatedInput?: Record<string, unknown>;
      reason?: string;
    }
  | { type: 'hookUpdatedInput'; updatedInput: Record<string, unknown> }
  | { type: 'preventContinuation'; shouldPreventContinuation: boolean }
  | { type: 'stopReason'; stopReason: string }
  | { type: 'additionalContext'; context: string }
  | { type: 'stop' };

/**
 * PostToolUse Hook解析结果
 */
export type PostToolUseHookYield<T = unknown> =
  | { type: 'message'; message: string }
  | { type: 'blockingError'; error: HookBlockingError }
  | { type: 'preventContinuation'; shouldPreventContinuation: boolean }
  | { type: 'additionalContext'; context: string }
  | { type: 'updatedToolOutput'; output: T };

/**
 * 创建基础工具Hook结果
 */
export function createToolHookResult(
  overrides: Partial<ToolHookResult> = {}
): ToolHookResult {
  return {
    outcome: 'success',
    ...overrides,
  };
}

/**
 * 创建成功的工具Hook结果
 */
export function createToolHookSuccessResult(output?: string): ToolHookResult {
  return {
    outcome: 'success',
    message: output,
  };
}

/**
 * 创建阻塞的工具Hook结果
 */
export function createToolHookBlockingResult(
  blockingError: string,
  command: string,
  reason?: string
): ToolHookResult {
  return {
    outcome: 'blocking',
    blockingError: { blockingError, command },
    stopReason: reason,
  };
}

/**
 * 创建取消的工具Hook结果
 */
export function createToolHookCancelledResult(): ToolHookResult {
  return {
    outcome: 'cancelled',
  };
}
