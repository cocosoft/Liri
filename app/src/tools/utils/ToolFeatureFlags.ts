/**
 * 工具功能开关配置
 * 用于控制工具的启用/禁用
 *
 * 统一来源：core/featureFlags.ts
 * 映射表位于 core/featureFlags.ts 的 TOOL_FLAG_MAP
 */

import { getToolFlag, TOOL_NAMES } from '@modules/core';

export interface ToolFeatureFlag {
  name: string;
  enabled: boolean;
  description?: string;
}

export const TOOL_FEATURE_FLAGS: Record<string, boolean> = {};
for (const toolName of TOOL_NAMES) {
  TOOL_FEATURE_FLAGS[toolName] = getToolFlag(toolName);
}

export function isToolEnabled(toolName: string): boolean {
  return TOOL_FEATURE_FLAGS[toolName] ?? false;
}

export function setToolEnabled(toolName: string, enabled: boolean): void {
  TOOL_FEATURE_FLAGS[toolName] = enabled;
}

export function getAllToolFlags(): Record<string, boolean> {
  return { ...TOOL_FEATURE_FLAGS };
}

export function getEnabledTools(): string[] {
  return Object.entries(TOOL_FEATURE_FLAGS)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

export function getDisabledTools(): string[] {
  return Object.entries(TOOL_FEATURE_FLAGS)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => name);
}

export function resetToolFlags(): void {
  for (const toolName of TOOL_NAMES) {
    TOOL_FEATURE_FLAGS[toolName] = getToolFlag(toolName);
  }
}
