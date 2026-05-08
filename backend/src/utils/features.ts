//
/**
 * 功能开关模块
 * 用于管理应用中的功能开关，支持从环境变量中读取配置
 *
 * 统一标志来源：@modules/core/featureFlags.ts
 */
import { FEATURE_FLAGS, feature, type FeatureFlag as CoreFeatureFlag } from '@modules/core';
import { isEnvTruthy } from './envUtils.js';
import { getFeatureFlagManager } from '../services/growthbook/FeatureFlagManager.js';
import { getGrowthBookClient } from '../services/growthbook/GrowthBookClient.js';
import type { GrowthBookUserAttributes } from '../services/growthbook/GrowthBookConfig.js';

/**
 * 扩展功能标志常量（工具层专用，保持向后兼容）
 * 核心标志来自 @modules/core，此处仅补充工具层专用标志
 */
export const FeatureFlag = {
  // 从核心导入的统一标志
  ENABLE_PLUGINS: 'ENABLE_PLUGINS' as const,
  ENABLE_SKILLS: 'ENABLE_SKILLS' as const,
  ENABLE_MCP: 'ENABLE_MCP' as const,
  ENABLE_WORKFLOWS: 'ENABLE_WORKFLOWS' as const,
  ENABLE_ADVANCED_COMMANDS: 'ENABLE_ADVANCED_COMMANDS' as const,
  AGENT_TRIGGERS: 'AGENT_TRIGGERS' as const,
  AGENT_TRIGGERS_REMOTE: 'AGENT_TRIGGERS_REMOTE' as const,
  PROACTIVE: 'PROACTIVE' as const,
  KAIROS: 'KAIROS' as const,
  MONITOR_TOOL: 'MONITOR_TOOL' as const,
  CONTEXT_COLLAPSE: 'CONTEXT_COLLAPSE' as const,
  HISTORY_SNIP: 'HISTORY_SNIP' as const,
  VOICE_MODE: 'VOICE_MODE' as const,
  BRIDGE_MODE: 'BRIDGE_MODE' as const,

  // 工具层专用标志（不在 core 中）
  ENABLE_LSP_TOOL: 'ENABLE_LSP_TOOL' as const,
  ENABLE_REPL: 'ENABLE_REPL' as const,
  ENABLE_VERIFY_PLAN: 'ENABLE_VERIFY_PLAN' as const,
  ENABLE_TEST_MODE: 'ENABLE_TEST_MODE' as const,
  ENABLE_KAIROS_PUSH_NOTIFICATION: 'ENABLE_KAIROS_PUSH_NOTIFICATION' as const,
  ENABLE_KAIROS_GITHUB_WEBHOOKS: 'ENABLE_KAIROS_GITHUB_WEBHOOKS' as const,
  ENABLE_TERMINAL_PANEL: 'ENABLE_TERMINAL_PANEL' as const,
  ENABLE_WEB_BROWSER_TOOL: 'ENABLE_WEB_BROWSER_TOOL' as const,
  ENABLE_COORDINATOR_MODE: 'ENABLE_COORDINATOR_MODE' as const,
  ENABLE_UDS_INBOX: 'ENABLE_UDS_INBOX' as const,
  ENABLE_WORKFLOW_SCRIPTS: 'ENABLE_WORKFLOW_SCRIPTS' as const,
  ENABLE_OVERFLOW_TEST_TOOL: 'ENABLE_OVERFLOW_TEST_TOOL' as const,
  ENABLE_SIMPLE_MODE: 'CLAUDE_CODE_SIMPLE' as const,
  USER_TYPE_ANT: 'USER_TYPE' as const,
  ENABLE_CACHE: 'ENABLE_CACHE' as const,
  ENABLE_MEMORY_MONITORING: 'ENABLE_MEMORY_MONITORING' as const,
  ENABLE_PERFORMANCE_TRACKING: 'ENABLE_PERFORMANCE_TRACKING' as const,
  ENABLE_PERMISSION_CHECKS: 'ENABLE_PERMISSION_CHECKS' as const,
  ENABLE_SECURITY_SCAN: 'ENABLE_SECURITY_SCAN' as const,
  ENABLE_DEBUG_MODE: 'ENABLE_DEBUG_MODE' as const,
  ENABLE_DEV_FEATURES: 'ENABLE_DEV_FEATURES' as const,
} as const;

export type FeatureFlagName = (typeof FeatureFlag)[keyof typeof FeatureFlag];

/**
 * 检查功能是否启用
 * 优先从环境变量读取，其次使用 core/featureFlags 统一默认值，最后回退到本地默认
 */
export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  const envValue = process.env[flag];
  if (envValue !== undefined) {
    return envValue === 'true';
  }
  return feature(flag as CoreFeatureFlag);
}

/**
 * 获取所有功能开关状态
 * @returns 功能开关状态映射
 */
export function getFeatureFlags(): Record<FeatureFlag, boolean> {
  const flags: Record<FeatureFlag, boolean> = {} as Record<FeatureFlag, boolean>;
  
  Object.values(FeatureFlag).forEach(feature => {
    flags[feature] = isFeatureEnabled(feature);
  });
  
  return flags;
}

/**
 * 检查是否为开发模式
 * @returns 是否为开发模式
 */
export function isDevMode(): boolean {
  return isFeatureEnabled(FeatureFlag.ENABLE_DEV_FEATURES) || 
         isFeatureEnabled(FeatureFlag.ENABLE_DEBUG_MODE);
}

/**
 * 检查是否为测试模式
 * @returns 是否为测试模式
 */
export function isTestMode(): boolean {
  return isFeatureEnabled(FeatureFlag.ENABLE_TEST_MODE);
}

/**
 * 条件加载工具的辅助函数
 * 如果功能启用则返回值，否则返回null
 * 类似于CC源码的feature()函数模式
 */
export function conditionalTool<T>(flag: FeatureFlag, tool: T | null): T | null {
  return isFeatureEnabled(flag) ? tool : null;
}

/**
 * 条件启用多个工具
 */
export function conditionalTools<T>(flag: FeatureFlag, tools: T[]): T[] {
  return isFeatureEnabled(flag) ? tools : [];
}

/**
 * 检查是否为ANT用户类型
 */
export function isAntUser(): boolean {
  return process.env.USER_TYPE === 'ant';
}

/**
 * 检查是否为简单模式
 */
export function isSimpleMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE);
}

/**
 * 检查是否启用工作树模式
 */
export function isWorktreeModeEnabled(): boolean {
  return isFeatureEnabled(FeatureFlag.ENABLE_KAIROS);
}

/**
 * 检查是否启用Agent Swarms
 */
export function isAgentSwarmsEnabled(): boolean {
  return isFeatureEnabled(FeatureFlag.ENABLE_KAIROS);
}

/**
 * 检查是否启用任务V2
 */
export function isTodoV2Enabled(): boolean {
  return isFeatureEnabled(FeatureFlag.ENABLE_WORKFLOWS);
}

let growthBookIntegrationInitialized = false

export async function initGrowthBookIntegration(attributes: GrowthBookUserAttributes): Promise<void> {
  if (growthBookIntegrationInitialized) return

  const client = getGrowthBookClient()
  if (!client.isEnabled()) {
    growthBookIntegrationInitialized = true
    return
  }

  const flagManager = getFeatureFlagManager()

  for (const [flag, defaultVal] of Object.entries(FEATURE_DEFAULTS)) {
    flagManager.registerLocalFlag({
      key: flag,
      defaultValue: defaultVal,
      category: 'local',
    })
  }

  await client.initialize(attributes)
  growthBookIntegrationInitialized = true
}

export function isGrowthBookEnabled(): boolean {
  return getGrowthBookClient().isEnabled()
}

export function getFeatureValueByGrowthBook<T>(feature: string, defaultValue: T): T {
  const mgr = getFeatureFlagManager()
  return mgr.getFlagCached<T>(feature, defaultValue)
}

export function evaluateFeatureFlag(feature: FeatureFlag): boolean {
  const envValue = process.env[feature]
  if (envValue !== undefined) {
    return envValue === 'true'
  }

  if (isGrowthBookEnabled()) {
    return getFeatureValueByGrowthBook<boolean>(feature, FEATURE_DEFAULTS[feature])
  }

  return FEATURE_DEFAULTS[feature]
}
