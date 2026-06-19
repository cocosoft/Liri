/**
 * 工具使用权限检查Hook
 */

import { useMemo, useState, useCallback, useEffect } from 'react';
import {
  hasPermissionsToUseTool,
  type ToolPermissionContext,
  type PermissionResult,
} from '@modules/permission';

/**
 * 工具权限检查结果
 */
export interface UseCanUseToolResult {
  /** 是否可以使用工具 */
  canUse: boolean;
  /** 权限决策 */
  permissionResult: PermissionResult<Record<string, unknown>>;
  /** 拒绝原因（如果被拒绝） */
  denialReason?: string;
  /** 决策原因描述 */
  decisionReason?: string;
}

/**
 * useCanUseTool Hook
 * @param toolName 工具名称
 * @param input 工具输入参数
 * @param context 权限上下文
 * @returns 权限检查结果
 */
export function useCanUseTool(
  toolName: string,
  input: Record<string, unknown> = {},
  context: ToolPermissionContext
): UseCanUseToolResult {
  const [result, setResult] = useState<PermissionResult<
    Record<string, unknown>
  > | null>(null);

  // 执行权限检查
  const checkPermission = useCallback(() => {
    const permissionResult = hasPermissionsToUseTool(toolName, input, context);
    setResult(permissionResult);
  }, [toolName, input, context]);

  // 初始检查和依赖变化时重新检查
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  const canUse = useMemo(() => {
    if (!result) return false;
    return result.behavior === 'allow';
  }, [result]);

  const denialReason = useMemo(() => {
    if (!result || result.behavior !== 'deny') return undefined;
    return result.message;
  }, [result]);

  const decisionReason = useMemo(() => {
    if (!result?.decisionReason) return undefined;
    const reason = result.decisionReason;
    if (reason.type === 'rule') {
      return `${reason.source}: ${reason.rule.ruleBehavior} ${reason.rule.ruleValue.toolName}`;
    }
    if (reason.type === 'config') {
      return `Config: ${reason.source}`;
    }
    return 'Default behavior';
  }, [result]);

  return {
    canUse,
    permissionResult: result || {
      behavior: 'ask',
      decisionReason: { type: 'default' },
    } as PermissionResult<Record<string, unknown>>,
    denialReason,
    decisionReason,
  };
}

/**
 * useCanUseTool 的简化版本，仅返回布尔值
 */
export function useCanUseToolSimple(
  toolName: string,
  input: Record<string, unknown> = {},
  context: ToolPermissionContext
): boolean {
  const { canUse } = useCanUseTool(toolName, input, context);
  return canUse;
}
