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
import { resolveProjectRoot, resolvePyappHome } from '@modules/core';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('config:layers:ProfileManager');

/**
 * 配置层叠 Profile 定义（组合式声明，无继承——11.2 P1-5 决策）。
 */
export interface LayerProfile {
  name: string;
  /** 按序启用的配置包 */
  bundles: string[];
  /** 环境专属覆盖（key 路径 → 值，`null` 为删除标记） */
  patches: Record<string, unknown>;
  /** 文件实际来源（内置/项目/用户） */
  source: 'builtin' | 'project' | 'user';
  /** 是否允许被覆盖（受控：development/test 可覆盖；staging/production 禁） */
  protected: boolean;
}

export interface ProfileSelection {
  name: string;
  source: 'cli' | 'env' | 'default';
}

/** 内置 profile 目录（随代码分发） */
export function getBuiltinProfilesDir(): string {
  return join(resolveProjectRoot(), 'app', 'config', 'layers', 'profiles');
}

/** 项目 profile 目录 */
export function getProjectProfilesDir(): string {
  return join(resolvePyappHome(), 'profiles');
}

/** 用户 profile 目录 */
export function getUserProfilesDir(): string {
  return join(resolvePyappHome(), 'profiles');
}

/** 受控保护：禁止用户/项目覆盖的内置 Profile */
const PROTECTED_PROFILES = new Set(['staging', 'production']);

function parseProfileYaml(
  filePath: string,
  name: string
): Pick<LayerProfile, 'bundles' | 'patches'> {
  if (!existsSync(filePath)) {
    throw new Error(`Profile file not found: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf-8');
  const parsed = yamlLoad(content) as Record<string, unknown>;
  const bundles = Array.isArray(parsed?.bundles)
    ? (parsed.bundles as unknown[]).filter(
        (b): b is string => typeof b === 'string'
      )
    : [];
  const patches = (parsed?.patches as Record<string, unknown>) ?? {};
  return { bundles, patches };
}

/**
 * 按三层搜索顺序加载 Profile：内置（随代码）< 项目 < 用户。
 * - development/test：允许项目/用户覆盖内置（本地调试自由）；
 * - staging/production：内置 Profile 受控保护，禁止覆盖（需 allowOverride 显式放行，11.10/11.12）。
 */
export function loadProfile(
  name: string,
  opts: { allowOverride?: boolean } = {}
): LayerProfile {
  const builtinDir = getBuiltinProfilesDir();
  const userDirs = [getProjectProfilesDir(), getUserProfilesDir()];

  // 受控保护：staging/production 内置 profile 禁止用户覆盖
  const isProtected = PROTECTED_PROFILES.has(name);
  if (isProtected && !opts.allowOverride) {
    const builtinPath = join(builtinDir, `${name}.yaml`);
    if (existsSync(builtinPath)) {
      const def = parseProfileYaml(builtinPath, name);
      return { name, ...def, source: 'builtin', protected: true };
    }
    throw new Error(`Profile not found (protected, builtin required): ${name}`);
  }

  // 高层优先：用户 > 项目 > 内置
  for (const dir of userDirs) {
    const p = join(dir, `${name}.yaml`);
    if (existsSync(p)) {
      const def = parseProfileYaml(p, name);
      const source: LayerProfile['source'] =
        dir === getUserProfilesDir() ? 'user' : 'project';
      logger.info('Profile 命中（非内置）', { name, source, path: p });
      return { name, ...def, source, protected: false };
    }
  }

  const builtinPath = join(builtinDir, `${name}.yaml`);
  if (existsSync(builtinPath)) {
    const def = parseProfileYaml(builtinPath, name);
    return { name, ...def, source: 'builtin', protected: false };
  }

  // 默认 development 空 Profile（11.9.2 决策：无差异声明，向后兼容）
  if (name === 'development') {
    return {
      name,
      bundles: [],
      patches: {},
      source: 'builtin',
      protected: false,
    };
  }

  throw new Error(`Profile not found: ${name}`);
}

/**
 * Profile 选择优先级：CLI > 环境变量 > 默认 development（11.9.2：development 为空 Profile）。
 */
export function selectProfile(
  opts: { cli?: string; env?: string } = {}
): ProfileSelection {
  if (opts.cli) return { name: opts.cli, source: 'cli' };
  if (opts.env) return { name: opts.env, source: 'env' };
  return { name: 'development', source: 'default' };
}
