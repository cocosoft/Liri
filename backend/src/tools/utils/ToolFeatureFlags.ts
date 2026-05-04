/**
 * 工具功能开关配置
 * 用于控制工具的启用/禁用
 */

export interface ToolFeatureFlag {
  name: string;
  enabled: boolean;
  description?: string;
}

export const TOOL_FEATURE_FLAGS: Record<string, boolean> = {
  ENABLE_BASH: true,
  ENABLE_FILE_READ: true,
  ENABLE_FILE_WRITE: true,
  ENABLE_FILE_EDIT: true,
  ENABLE_GREP: true,
  ENABLE_GLOB: true,
  ENABLE_WEB_FETCH: true,
  ENABLE_WEB_SEARCH: true,
  ENABLE_AGENT: true,
  ENABLE_SKILL: true,
  ENABLE_TASK: true,
  ENABLE_TODO: true,
  ENABLE_BRIEF: true,
  ENABLE_CONFIG: true,
  ENABLE_PLAN: true,
  ENABLE_MCP: true,
  ENABLE_NOTEBOOK: true,
  ENABLE_CHRONOS: true,
  ENABLE_TUNGSTEN: true,
  ENABLE_ASK: true,
  ENABLE_SEND_MESSAGE: false,
  ENABLE_TEAM_CREATE: false,
  ENABLE_TEAM_DELETE: false,
  ENABLE_SLEEP: false,
  ENABLE_MONITOR: false,
  ENABLE_BROWSER: false,
  ENABLE_WORKTREE: true,
  ENABLE_VOICE: false,
  ENABLE_CODE_ANALYSIS: false,
  ENABLE_REPL: false,
};

export function isToolEnabled(toolName: string): boolean {
  return TOOL_FEATURE_FLAGS[toolName] ?? false;
}

export function setToolEnabled(toolName: string, enabled: boolean): void {
  TOOL_FEATURE_FLAGS[toolName] = enabled;
}

export function getAllToolFlags(): ToolFeatureFlag[] {
  return Object.entries(TOOL_FEATURE_FLAGS).map(([name, enabled]) => ({
    name,
    enabled,
  }));
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
  Object.keys(TOOL_FEATURE_FLAGS).forEach((key) => {
    const defaultValue = key.startsWith('ENABLE_') && !key.includes('TEAM') && !key.includes('SLEEP') && !key.includes('MONITOR') && !key.includes('BROWSER') && !key.includes('VOICE') && !key.includes('CODE_ANALYSIS') && !key.includes('REPL') && !key.includes('SEND_MESSAGE');
    TOOL_FEATURE_FLAGS[key] = defaultValue;
  });
}