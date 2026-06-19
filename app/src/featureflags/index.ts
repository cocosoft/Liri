// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 功能开关模块（向后兼容 shim 层）
 * 委托到 @modules/core/featureFlags 统一数据源
 * 保留环境变量覆盖能力（FEATURE_* 前缀）
 */

import { feature as coreFeature, type FeatureFlag } from '@modules/core';

const featureCache: Partial<Record<string, boolean>> = {};

/** 旧 FeatureName → 环境变量名 + core flag 名映射 */
const LEGACY_FLAG_MAP: Record<string, { flag: string; envVar: string }> = {
  COORDINATOR_MODE: {
    flag: 'COORDINATOR_MODE',
    envVar: 'FEATURE_COORDINATOR_MODE',
  },
  KAIROS: { flag: 'KAIROS', envVar: 'FEATURE_KAIROS' },
  PROACTIVE: { flag: 'PROACTIVE', envVar: 'FEATURE_PROACTIVE' },
  TEAMMEM: { flag: 'TEAMMEM', envVar: 'FEATURE_TEAMMEM' },
  BRIDGE_MODE: { flag: 'BRIDGE_MODE', envVar: 'FEATURE_BRIDGE_MODE' },
  DAEMON: { flag: 'DAEMON', envVar: 'FEATURE_DAEMON' },
  VOICE_MODE: { flag: 'VOICE_MODE', envVar: 'FEATURE_VOICE_MODE' },
  SANDBOX: { flag: 'SANDBOX', envVar: 'FEATURE_SANDBOX' },
  MCP_OAUTH: { flag: 'MCP_OAUTH', envVar: 'FEATURE_MCP_OAUTH' },
  COMMAND_PIPELINE: {
    flag: 'COMMAND_PIPELINE',
    envVar: 'FEATURE_COMMAND_PIPELINE',
  },
};

export function feature(name: string): boolean {
  if (featureCache[name] !== undefined) {
    return featureCache[name]!;
  }

  const mapping = LEGACY_FLAG_MAP[name];
  if (!mapping) {
    return false;
  }

  // 优先检查旧格式环境变量（向后兼容）
  const envValue = process.env[mapping.envVar];
  if (envValue !== undefined) {
    const result = envValue === 'true';
    featureCache[name] = result;
    return result;
  }

  // 委托到统一数据源
  const result = coreFeature(mapping.flag as FeatureFlag);
  featureCache[name] = result;
  return result;
}

export function setFeature(name: string, value: boolean): void {
  featureCache[name] = value;
}

export function clearFeatureCache(): void {
  Object.keys(featureCache).forEach((key) => {
    delete featureCache[key];
  });
}

export function conditionalImport<T>(
  featureName: string,
  importFn: () => Promise<T>,
  fallback: T
): Promise<T> {
  if (feature(featureName)) {
    return importFn();
  }
  return Promise.resolve(fallback);
}

export type { FeatureName } from './types.js';
export const FEATURE_LIST = Object.entries(LEGACY_FLAG_MAP).map(
  ([name, mapping]) => ({
    name,
    description: '',
    defaultValue: coreFeature(mapping.flag as FeatureFlag),
    envVar: mapping.envVar,
  })
);
