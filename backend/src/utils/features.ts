/**
 * 功能开关模块
 * 用于管理应用中的功能开关，支持从环境变量中读取配置
 *
 * 统一标志来源：@modules/core/featureFlags.ts
 */
import {
  FEATURE_FLAGS,
  feature as coreFeature,
  type FeatureFlag as CoreFeatureFlag,
} from '@modules/core';
import { isEnvTruthy } from './envUtils.js';
import { getFeatureFlagManager } from '../services/growthbook/FeatureFlagManager.js';
import { getGrowthBookClient } from '../services/growthbook/GrowthBookClient.js';
import type { GrowthBookUserAttributes } from '../services/growthbook/GrowthBookConfig.js';

/**
 * 功能标志名称常量（向后兼容）
 * 每个键映射到自身的标志名称字符串
 */
export const FeatureFlag: { readonly [K in FeatureFlagName]: K } = {} as any;
for (const key of Object.keys(FEATURE_FLAGS)) {
  (FeatureFlag as any)[key] = key;
}

export type FeatureFlagName = CoreFeatureFlag;

/**
 * 检查功能是否启用
 * 优先从环境变量读取，其次使用 core/featureFlags 统一默认值
 */
export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  const envValue = process.env[flag];
  if (envValue !== undefined) {
    return envValue === 'true';
  }
  return coreFeature(flag);
}

/**
 * 获取所有功能开关状态
 * @returns 功能开关状态映射
 */
export function getFeatureFlags(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURE_FLAGS)) {
    result[key] = isFeatureEnabled(key as FeatureFlagName);
  }
  return result;
}

/**
 * 检查是否为开发模式
 * @returns 是否为开发模式
 */
export function isDevMode(): boolean {
  return isFeatureEnabled('DEV_FEATURES') || isFeatureEnabled('DEBUG_MODE');
}

/**
 * 检查是否为测试模式
 * @returns 是否为测试模式
 */
export function isTestMode(): boolean {
  return isFeatureEnabled('TEST_MODE');
}

/**
 * 条件加载工具的辅助函数
 * 如果功能启用则返回值，否则返回null
 */
export function conditionalTool<T>(
  flag: FeatureFlagName,
  tool: T | null
): T | null {
  return isFeatureEnabled(flag) ? tool : null;
}

export function conditionalTools<T>(flag: FeatureFlagName, tools: T[]): T[] {
  return isFeatureEnabled(flag) ? tools : [];
}

/**
 * 检查是否为 ANT 用户类型
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
  return isFeatureEnabled('KAIROS');
}

export function isAgentSwarmsEnabled(): boolean {
  return isFeatureEnabled('KAIROS');
}

/**
 * 检查是否启用任务V2
 */
export function isTodoV2Enabled(): boolean {
  return isFeatureEnabled('ENABLE_WORKFLOWS');
}

/** 本地默认值（用于 GrowthBook 降级） */
const FEATURE_DEFAULTS: Record<string, boolean> = {};
for (const [key, val] of Object.entries(FEATURE_FLAGS)) {
  FEATURE_DEFAULTS[key] = val;
}

let growthBookIntegrationInitialized = false;

export async function initGrowthBookIntegration(
  attributes: GrowthBookUserAttributes
): Promise<void> {
  if (growthBookIntegrationInitialized) return;

  const client = getGrowthBookClient();
  if (!client.isEnabled()) {
    growthBookIntegrationInitialized = true;
    return;
  }

  const flagManager = getFeatureFlagManager();

  for (const [flag, defaultVal] of Object.entries(FEATURE_DEFAULTS)) {
    flagManager.registerLocalFlag({
      key: flag,
      defaultValue: defaultVal,
      category: 'local',
    });
  }

  await client.initialize(attributes);
  growthBookIntegrationInitialized = true;
}

export function isGrowthBookEnabled(): boolean {
  return getGrowthBookClient().isEnabled();
}

export function getFeatureValueByGrowthBook<T>(
  feature: string,
  defaultValue: T
): T {
  const mgr = getFeatureFlagManager();
  return mgr.getFlagCached<T>(feature, defaultValue);
}

export function evaluateFeatureFlag(feature: FeatureFlagName): boolean {
  const envValue = process.env[feature];
  if (envValue !== undefined) {
    return envValue === 'true';
  }

  if (isGrowthBookEnabled()) {
    return getFeatureValueByGrowthBook<boolean>(
      feature,
      FEATURE_DEFAULTS[feature]
    );
  }

  return FEATURE_DEFAULTS[feature];
}
