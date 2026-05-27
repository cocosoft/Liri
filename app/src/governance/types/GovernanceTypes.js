/**
 * 治理闭环类型定义
 * 定义治理闭环的类型、接口和工具执行上下文
 */

/**
 * 工具执行状态
 */
export const ToolExecutionStatus = {
  PENDING: 'pending',
  VALIDATING: 'validating',
  CHECKING_PERMISSIONS: 'checking_permissions',
  EXECUTING_HOOKS: 'executing_hooks',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * 工具执行事件类型
 */
export const GovernanceEventType = {
  TOOL_DISCOVERED: 'tool_discovered',
  TOOL_VALIDATED: 'tool_validated',
  PERMISSION_CHECK: 'permission_check',
  PRE_HOOK_EXECUTION: 'pre_hook_execution',
  TOOL_EXECUTION: 'tool_execution',
  POST_HOOK_EXECUTION: 'post_hook_execution',
  TOOL_COMPLETED: 'tool_completed',
  TOOL_FAILED: 'tool_failed',
  SANDBOX_VIOLATION: 'sandbox_violation',
  GOVERNANCE_AUDIT: 'governance_audit',
};

/**
 * 创建默认治理配置
 */
export function createDefaultGovernanceConfig() {
  return {
    enabled: true,
    enforcePermission: true,
    enforceSandbox: false,
    enforceHooks: true,
    enforceFeatureFlags: true,
    maxExecutionTimeMs: 300000,
    allowParallelExecution: true,
    // 新增配置选项
    maxConcurrentExecutions: 10,
    auditRetentionDays: 30,
    strategyEvaluationInterval: 60000,
    autoCleanup: true,
    metricsCollection: true,
  };
}
