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

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { resolvePyappHome } from '@modules/core';
import { getBuildVariant } from '@modules/core/featureFlags';
import { configManager } from '@modules/config';
import { providerRegistry } from '../../ai/providers/ProviderRegistry';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';

import {
  selectProfile,
  loadProfile,
  type LayerProfile,
} from './ProfileManager';
import { loadBundles } from './BundleManager';
import { resolveConfigLayers, type ConfigLayersResult } from './ConfigLayers';
import { validateReferences } from './ReferenceValidator';
import { resolveEnvVars } from './EnvVarResolver';

const logger = getLogger('config:layers:ConfigLayersService');

/**
 * 配置层叠服务（步骤 4：挂在 UnifiedConfigManager 之下的统一入口，11.2 P1-3）。
 * 编排：选 Profile → 加载 Profile/Bundle → 取现有 5 源 → 11 层合并 → 归属校验。
 */

export interface ResolveLayersOptions {
  /** CLI --profile（优先级最高） */
  profileName?: string;
  /** CLI --patch（最高层，受 policy 保护） */
  cliPatch?: Record<string, unknown>;
  /** --locked：忽略 用户/项目/本地/Home/env/CLI patch 层（11.11） */
  locked?: boolean;
  /** --allow-override：允许覆盖 staging/production 内置 profile（11.12） */
  allowOverride?: boolean;
}

export interface ResolveLayersResult extends ConfigLayersResult {
  profile: LayerProfile;
  selection: { name: string; source: 'cli' | 'env' | 'default' };
}

/** 敏感 key 名片段（PYAPP_* 层跳过，11.12"只承载非敏感配置"） */
const SENSITIVE_KEY_SEGMENTS = [
  'apikey',
  'api_key',
  'token',
  'secret',
  'password',
  'credential',
];

function isSensitivePath(segments: string[]): boolean {
  return segments.some((seg) =>
    SENSITIVE_KEY_SEGMENTS.some((s) => seg.includes(s))
  );
}

function setNested(
  target: Record<string, unknown>,
  segments: string[],
  value: unknown
): void {
  let node = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof node[seg] !== 'object' || node[seg] === null) {
      node[seg] = {};
    }
    node = node[seg] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

function parseEnvValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;
  return value;
}

/**
 * 解析 PYAPP_* 环境变量层（11.12 定案）：
 * - `__` 嵌套分隔符（PYAPP_AI__DEFAULTMODEL → ai.defaultModel），小写归一化；
 * - 跳过敏感 key（apiKey/token/secret 等），仅承载非敏感配置。
 */
export function parseEnvLayer(prefix = 'PYAPP_'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix)) continue;
    if (value === undefined || value === '') continue;
    const rawPath = key.slice(prefix.length).toLowerCase();
    const segments = rawPath.split('__').filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    if (isSensitivePath(segments)) {
      logger.warn('PYAPP_* 跳过敏感 key', { key });
      continue;
    }
    setNested(out, segments, parseEnvValue(value));
  }
  return out;
}

/** 加载 Home patch（~/.pyapp/patches.yaml，临时调试补丁） */
export function loadHomePatch(): Record<string, unknown> {
  const filePath = join(resolvePyappHome(), 'patches.yaml');
  if (!existsSync(filePath)) return {};
  try {
    const parsed = yamlLoad(readFileSync(filePath, 'utf-8')) as Record<
      string,
      unknown
    >;
    return parsed ?? {};
  } catch (err) {
    logger.warn('Home patch 解析失败，忽略', { error: String(err) });
    return {};
  }
}

/**
 * 归属校验接线：providerId → providerRegistry.has；modelId → providerRegistry.getByModel 可解析。
 */
async function buildReferenceCheckers(): Promise<{
  providerExists: (id: string) => boolean;
  modelExists: (model: string) => boolean;
}> {
  return {
    providerExists: (id: string) => providerRegistry.has(id),
    modelExists: (model: string) => {
      try {
        return providerRegistry.getByModel(model) !== undefined;
      } catch {
        return false;
      }
    },
  };
}

/**
 * 执行配置层叠完整管线（11 层 + 归属校验）。
 */
export async function resolveLayers(
  opts: ResolveLayersOptions = {}
): Promise<ResolveLayersResult> {
  const selection = selectProfile({
    cli: opts.profileName,
    env: process.env['PYAPP_PROFILE'],
  });
  const profile = loadProfile(selection.name, {
    allowOverride: opts.allowOverride,
  });

  const variant = getBuildVariant();
  const { bundles, notLoaded } = loadBundles(profile.bundles, { variant });

  // ${ENV_VAR} 变量替换（11.4）：每层加载后立即替换，避免跨层残留未解析引用
  const resolve = (v: Record<string, unknown> | undefined) =>
    v ? resolveEnvVars(v) : undefined;

  const layerInput = {
    profile,
    bundles: bundles.map((b) => ({ ...b, config: resolveEnvVars(b.config) })),
    notLoadedBundles: notLoaded,
    defaultConfig: configManager.getMergedConfig?.() ?? {},
    userSettings: resolve(configManager.getSourceConfig('userSettings')),
    projectSettings: resolve(configManager.getSourceConfig('projectSettings')),
    localSettings: resolve(configManager.getSourceConfig('localSettings')),
    flagSettings: resolve(configManager.getSourceConfig('flagSettings')),
    policySettings: resolve(configManager.getSourceConfig('policySettings')),
    homePatch: opts.locked ? undefined : resolve(loadHomePatch()),
    envLayer: opts.locked ? undefined : parseEnvLayer(),
    cliPatch: opts.locked ? undefined : resolve(opts.cliPatch),
    locked: opts.locked,
  };

  const merged = resolveConfigLayers(layerInput);

  // 归属校验（1.3 ②）：引用型字段必须存在于 DB registry，否则 fail-fast
  const checkers = await buildReferenceCheckers();
  const validation = await validateReferences(merged.config, checkers);
  if (!validation.ok) {
    const detail = validation.violations
      .map((v) => `${v.path} = ${v.value}`)
      .join('; ');
    throw new AppError(
      `配置归属校验失败（数出同源）：${detail}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  logger.info('配置层叠解析完成', {
    profile: profile.name,
    source: selection.source,
    variant,
    layers: merged.layers.map((l) => l.name),
    notLoadedBundles: notLoaded,
    deletedKeys: merged.deletedKeys,
  });

  return { ...merged, profile, selection };
}
