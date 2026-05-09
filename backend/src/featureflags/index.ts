/**
 * 功能开关模块
 * 提供feature()函数和条件加载支持
 * 参考CC_CODE bun:bundle feature实现
 */

import { FeatureName, FeatureConfig } from './types.js';

const featureCache: Partial<Record<FeatureName, boolean>> = {};

const FEATURE_CONFIGS: FeatureConfig[] = [
  {
    name: 'COORDINATOR_MODE',
    description: '协调者模式',
    defaultValue: false,
    envVar: 'FEATURE_COORDINATOR_MODE',
  },
  {
    name: 'KAIROS',
    description: 'Kairos功能',
    defaultValue: false,
    envVar: 'FEATURE_KAIROS',
  },
  {
    name: 'PROACTIVE',
    description: '主动模式',
    defaultValue: false,
    envVar: 'FEATURE_PROACTIVE',
  },
  {
    name: 'TEAMMEM',
    description: '团队成员',
    defaultValue: false,
    envVar: 'FEATURE_TEAMMEM',
  },
  {
    name: 'BRIDGE_MODE',
    description: '桥接模式',
    defaultValue: false,
    envVar: 'FEATURE_BRIDGE_MODE',
  },
  {
    name: 'DAEMON',
    description: '守护进程',
    defaultValue: false,
    envVar: 'FEATURE_DAEMON',
  },
  {
    name: 'VOICE_MODE',
    description: '语音模式',
    defaultValue: false,
    envVar: 'FEATURE_VOICE_MODE',
  },
  {
    name: 'SANDBOX',
    description: '沙箱模式',
    defaultValue: true,
    envVar: 'FEATURE_SANDBOX',
  },
  {
    name: 'MCP_OAUTH',
    description: 'MCP OAuth认证',
    defaultValue: false,
    envVar: 'FEATURE_MCP_OAUTH',
  },
  {
    name: 'COMMAND_PIPELINE',
    description: '命令管道',
    defaultValue: false,
    envVar: 'FEATURE_COMMAND_PIPELINE',
  },
];

export function feature(name: FeatureName): boolean {
  if (featureCache[name] !== undefined) {
    return featureCache[name]!;
  }

  const config = FEATURE_CONFIGS.find((c) => c.name === name);
  if (!config) {
    return false;
  }

  const envValue = process.env[config.envVar];
  if (envValue !== undefined) {
    featureCache[name] = envValue === 'true';
    return featureCache[name]!;
  }

  featureCache[name] = config.defaultValue;
  return featureCache[name]!;
}

export function setFeature(name: FeatureName, value: boolean): void {
  featureCache[name] = value;
}

export function clearFeatureCache(): void {
  Object.keys(featureCache).forEach((key) => {
    delete featureCache[key as FeatureName];
  });
}

export function conditionalImport<T>(
  featureName: FeatureName,
  importFn: () => Promise<T>,
  fallback: T
): Promise<T> {
  if (feature(featureName)) {
    return importFn();
  }
  return Promise.resolve(fallback);
}

export type { FeatureName } from './types.js';
export const FEATURE_LIST = FEATURE_CONFIGS;
