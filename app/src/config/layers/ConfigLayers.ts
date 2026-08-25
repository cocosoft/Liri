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

import { deepMerge } from '../../utils/common';
import { applyPatch } from './PatchApplier';
import type { LayerBundle } from './BundleManager';
import type { LayerProfile } from './ProfileManager';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('config:layers:ConfigLayers');

/**
 * 配置层叠 11 层合并编排（正文四，2026-08-25 定案）。
 *
 * 层序（对齐现有 sourcePriority + 新增层）：
 *   1. 默认值  2. Bundle  3. Profile patch  4. 用户  5. 项目  6. 本地
 *   7. flagSettings  8. policySettings  9. Home patch  10. 环境变量  11. CLI --patch
 *
 * 关键语义：
 * - policySettings 保护：policy 已声明的 key 对 Home/env/CLI 层"锁定"（11.2 P1-1）；
 * - `--locked`：忽略 用户/项目/本地/Home/env/CLI patch 层（11.11）；
 * - Patch 类层（profile/home/cli）走墓碑删除（PatchApplier）；Bundle/普通源走 deepMerge。
 */

export interface ConfigLayersInput {
  profile: LayerProfile;
  /** 已按变体过滤后的 bundles（顺序 = 声明顺序） */
  bundles: LayerBundle[];
  /** variants 过滤/缺失 未加载的 bundle（dump 可观测） */
  notLoadedBundles?: Array<{ name: string; reason: string }>;
  /** 1. 默认值（createDefaultGlobalConfig 代码内置） */
  defaultConfig: Record<string, unknown>;
  userSettings?: Record<string, unknown>;
  projectSettings?: Record<string, unknown>;
  localSettings?: Record<string, unknown>;
  flagSettings?: Record<string, unknown>;
  policySettings?: Record<string, unknown>;
  homePatch?: Record<string, unknown>;
  envLayer?: Record<string, unknown>;
  cliPatch?: Record<string, unknown>;
  /** --locked 模式：忽略 用户/项目/本地/Home/env/CLI patch（11.11） */
  locked?: boolean;
}

export interface ConfigLayerEntry {
  name: string;
  config: Record<string, unknown>;
}

export interface ConfigLayersResult {
  /** 最终合并配置 */
  config: Record<string, unknown>;
  /** 每层贡献（dump --layers 可观测） */
  layers: ConfigLayerEntry[];
  notLoadedBundles: Array<{ name: string; reason: string }>;
  /** 墓碑删除的 key 路径（含层名前缀的可观测信息） */
  deletedKeys: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 收集对象所有叶子路径（policy 锁定 key 集） */
export function collectLeafPaths(
  node: Record<string, unknown>,
  prefix = ''
): Set<string> {
  const paths = new Set<string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      const sub = collectLeafPaths(value, path);
      for (const s of sub) paths.add(s);
    } else {
      paths.add(path);
    }
  }
  return paths;
}

/** 移除对象中 policy 已锁定的 key（递归过滤），不修改原对象 */
function filterLocked(
  source: Record<string, unknown>,
  lockedPaths: Set<string>,
  prefix = ''
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (lockedPaths.has(path)) continue; // policy 锁定，跳过
    if (isPlainObject(value)) {
      const sub = filterLocked(value, lockedPaths, path);
      if (Object.keys(sub).length > 0) out[key] = sub;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isEmpty(obj: Record<string, unknown> | undefined): boolean {
  return !obj || Object.keys(obj).length === 0;
}

/**
 * 执行 11 层合并。
 */
export function resolveConfigLayers(
  input: ConfigLayersInput
): ConfigLayersResult {
  const layers: ConfigLayerEntry[] = [];
  const deletedKeys: string[] = [];

  // 1. 默认值
  let config = deepMerge({}, input.defaultConfig ?? {});
  layers.push({ name: 'default', config: { ...(input.defaultConfig ?? {}) } });

  // 2. Bundle 配置（按声明顺序 deepMerge，后声明胜——11.12）
  let bundleMerged: Record<string, unknown> = {};
  for (const b of input.bundles ?? []) {
    // common.deepMerge 返回新对象（不修改入参），须赋值接收
    bundleMerged = deepMerge(bundleMerged, b.config);
  }
  if (Object.keys(bundleMerged).length > 0) {
    config = deepMerge(config, bundleMerged);
    layers.push({ name: 'bundle', config: bundleMerged });
  }

  // 3. Profile patch（墓碑删除）
  const profilePatch = input.profile.patches ?? {};
  if (!isEmpty(profilePatch)) {
    const pp = applyPatch(config, profilePatch);
    config = pp.config;
    deletedKeys.push(...pp.deletedKeys.map((k) => `profile-patch:${k}`));
    layers.push({ name: 'profile-patch', config: { ...profilePatch } });
  }

  const mergeSource = (name: string, src?: Record<string, unknown>): void => {
    if (isEmpty(src)) return;
    config = deepMerge(config, src!);
    layers.push({ name, config: { ...src! } });
  };

  // 4-6. 用户/项目/本地（locked 模式忽略）
  if (!input.locked) {
    mergeSource('user', input.userSettings);
    mergeSource('project', input.projectSettings);
    mergeSource('local', input.localSettings);
  }

  // 7. flagSettings
  mergeSource('flag', input.flagSettings);

  // 8. policySettings（记录锁定 key，对 Home/env/CLI 生效）
  const policyConfig = input.policySettings ?? {};
  const lockedPaths = collectLeafPaths(policyConfig);
  mergeSource('policy', input.policySettings);

  // 9. Home patch（受 policy 保护；locked 跳过；墓碑删除）
  if (!input.locked && !isEmpty(input.homePatch)) {
    const filtered = filterLocked(input.homePatch!, lockedPaths);
    const r = applyPatch(config, filtered);
    config = r.config;
    deletedKeys.push(...r.deletedKeys.map((k) => `home-patch:${k}`));
    layers.push({ name: 'home-patch', config: filtered });
  }

  // 10. 环境变量层（PYAPP_*；受 policy 保护；locked 跳过）
  if (!input.locked && !isEmpty(input.envLayer)) {
    const filtered = filterLocked(input.envLayer!, lockedPaths);
    config = deepMerge(config, filtered);
    layers.push({ name: 'env', config: filtered });
  }

  // 11. CLI --patch（受 policy 保护；locked 跳过；墓碑删除）
  if (!input.locked && !isEmpty(input.cliPatch)) {
    const filtered = filterLocked(input.cliPatch!, lockedPaths);
    const r = applyPatch(config, filtered);
    config = r.config;
    deletedKeys.push(...r.deletedKeys.map((k) => `cli-patch:${k}`));
    layers.push({ name: 'cli-patch', config: filtered });
  }

  logger.info('配置层叠合并完成', {
    layers: layers.map((l) => l.name),
    deletedKeys,
    notLoadedBundles: input.notLoadedBundles,
  });

  return {
    config,
    layers,
    notLoadedBundles: input.notLoadedBundles ?? [],
    deletedKeys,
  };
}
