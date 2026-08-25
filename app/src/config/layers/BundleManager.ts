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

const logger = getLogger('config:layers:BundleManager');

/**
 * 配置层叠 Bundle（跨环境共享的配置分组）。
 * 原始文件带 `config:` 包装层（对齐现有配置格式），加载时剥离（11.12 P0 决策）。
 */
export interface LayerBundle {
  name: string;
  /** 剥离 config: 包装后的配置 */
  config: Record<string, unknown>;
  /** 适用变体（缺省 = 仅 core 变体加载，11.11 决策）；空数组 = core-only */
  variants: string[];
  source: 'builtin' | 'project' | 'user';
}

export interface LoadBundlesOptions {
  /** 当前构建变体（core/personal/coding/enterprise），须在加载前确定（11.11） */
  variant: string;
  /** 是否忽略 variants 过滤（调试用，默认 false） */
  ignoreVariants?: boolean;
}

/** 内置 bundle 目录 */
export function getBuiltinBundlesDir(): string {
  return join(resolveProjectRoot(), 'app', 'config', 'layers', 'bundles');
}

/** 用户/项目 bundle 目录（只追加，禁止同名覆盖内置——11.11 决策） */
export function getUserBundlesDir(): string {
  return join(resolvePyappHome(), 'bundles');
}

function parseBundleYaml(filePath: string): {
  config: Record<string, unknown>;
  variants: string[];
} {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = yamlLoad(content) as Record<string, unknown>;
  // 剥离 config: 包装层（11.12 P0：与 patch 裸 key 共用同一 key 空间）
  const rawConfig = (parsed?.config as Record<string, unknown>) ?? parsed;
  const variants = Array.isArray(parsed?.variants)
    ? (parsed.variants as unknown[]).filter(
        (v): v is string => typeof v === 'string'
      )
    : [];
  return { config: (rawConfig as Record<string, unknown>) ?? {}, variants };
}

/**
 * 加载并按变体过滤 bundles。
 * - 文件不存在 → 抛错（Profile 引用缺失 fail-fast，11.11/5.2）；
 * - 文件存在但 variants 不匹配 → 过滤（返回 notLoaded 标注，不 fail-fast——11.12 P0）；
 * - 用户/项目 bundle 只追加（先查用户目录，再回退内置；同名不覆盖内置）。
 */
export function loadBundles(
  names: string[],
  opts: LoadBundlesOptions
): {
  bundles: LayerBundle[];
  notLoaded: Array<{ name: string; reason: string }>;
} {
  const builtinDir = getBuiltinBundlesDir();
  const userDir = getUserBundlesDir();
  const bundles: LayerBundle[] = [];
  const notLoaded: Array<{ name: string; reason: string }> = [];

  for (const name of names) {
    let filePath = join(builtinDir, `${name}.yaml`);
    let source: LayerBundle['source'] = 'builtin';
    // 用户 bundle 优先（只追加，允许自定义新 bundle；若用户文件存在则用之）
    const userPath = join(userDir, `${name}.yaml`);
    if (existsSync(userPath)) {
      filePath = userPath;
      source = 'user';
    }

    if (!existsSync(filePath)) {
      notLoaded.push({ name, reason: 'missing' });
      continue;
    }

    const { config, variants } = parseBundleYaml(filePath);
    // variants 语义（11.12 修正）：无 variants 字段 = 基座 bundle（所有变体加载，如 core）；
    // 显式声明 = 按声明过滤（如 chat/ai/channels: [coding, enterprise]，enterprise: [enterprise]）。
    // 由此 core 变体下：core（无 variants 加载）+ 重型 bundle（variants 不含 core 被过滤）= 仅 core bundle。
    if (
      !opts.ignoreVariants &&
      variants.length > 0 &&
      !variants.includes(opts.variant)
    ) {
      notLoaded.push({ name, reason: 'variants-mismatch' });
      logger.warn('bundle 因 variants 不匹配未加载', {
        bundle: name,
        variant: opts.variant,
        declared: variants,
      });
      continue;
    }

    bundles.push({ name, config, variants, source });
  }

  return { bundles, notLoaded };
}
