/**
 * GrowthBook 功能开关集成层
 *
 * 职责：
 * - 仅处理 GrowthBook 远程功能开关的初始化和查询
 * - 基础功能标志请使用 @modules/core/featureFlags.ts
 */
import { FEATURE_FLAGS } from '@modules/core';
import { getFeatureFlagManager } from '../services/growthbook/FeatureFlagManager.js';
import { getGrowthBookClient } from '../services/growthbook/GrowthBookClient.js';
import type { GrowthBookUserAttributes } from '../services/growthbook/GrowthBookConfig.js';
import { isEnvTruthy } from './envUtils.js';

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

/**
 * 通过 GrowthBook 评估功能标志
 * 优先环境变量 → GrowthBook → core/featureFlags 默认值
 */
export function evaluateFeatureFlag(feature: string): boolean {
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

  return FEATURE_DEFAULTS[feature] ?? false;
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
