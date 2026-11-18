// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * gen-variant-capability-matrix.ts — 生成「变体能力矩阵」文档（2026-11-18）
 *
 * 为什么：`scripts/variant-matrix.ts` 是**唯一事实源**，但此前只以代码形式存在
 * （`STATUS.md` 只有 5 项计数，`docker.md` 只列变体名）⇒ 用户"选了变体却找不到功能"
 * 时没有一张可查的表。
 *
 * 本脚本**不引入第二份真相**：直接读 `VARIANT_MATRIX`，把
 * features / excludeFeatures / buildFeatures / minimalToolSurface 渲染成文档。
 * 单元格口径：
 *   ✅ = 该变体显式启用；⛔ = 显式排除；➖ = 未列出（沿用该开关默认值）
 *
 * 用法：
 *   bun run scripts/gen-variant-capability-matrix.ts          # 生成
 *   bun run scripts/gen-variant-capability-matrix.ts --check  # 仅校验（CI / pre-commit）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUILD_VARIANTS,
  VARIANT_MATRIX,
  type BuildVariant,
} from './variant-matrix';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'docs', '安装部署', '变体能力矩阵.md');

/** 单元格 */
function cell(variant: BuildVariant, feature: string): string {
  const spec = VARIANT_MATRIX[variant];
  if (spec.features.includes(feature)) return '✅';
  if (spec.excludeFeatures.includes(feature)) return '⛔';
  return '➖';
}

function build(): string {
  const features = [
    ...new Set(
      BUILD_VARIANTS.flatMap((v) => [
        ...VARIANT_MATRIX[v].features,
        ...VARIANT_MATRIX[v].excludeFeatures,
      ])
    ),
  ].sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  lines.push('# 变体能力矩阵');
  lines.push('');
  lines.push(
    '> 本文件由 `app/scripts/gen-variant-capability-matrix.ts` 生成（事实源：`app/scripts/variant-matrix.ts`），**请勿手改**。'
  );
  lines.push('> 更新：`cd app && bun run gen:variant-matrix-doc`；校验：`bun run lint:variant-matrix-doc`。');
  lines.push('');
  lines.push('图例：✅ 显式启用 · ⛔ 显式排除 · ➖ 未列出（沿用该开关默认值）');
  lines.push('');
  lines.push('## 1. 变体总览');
  lines.push('');
  lines.push('| 变体 | 说明 | 最小工具面 | 构建期裁剪 |');
  lines.push('|---|---|:--:|---|');
  for (const v of BUILD_VARIANTS) {
    const spec = VARIANT_MATRIX[v];
    const build = spec.buildFeatures.length > 0 ? spec.buildFeatures.join('、') : '—';
    lines.push(
      `| \`${v}\` | ${spec.description} | ${spec.minimalToolSurface ? '是' : '否'} | ${build} |`
    );
  }
  lines.push('');
  lines.push('> 「最小工具面」= 只保留 7 个基础工具（见 `variant-matrix.ts` 的 `core` 注释）。');
  lines.push('');
  lines.push('## 2. 能力开关矩阵');
  lines.push('');
  lines.push(`| 能力（FEATURE_FLAGS 键） | ${BUILD_VARIANTS.map((v) => `\`${v}\``).join(' | ')} |`);
  lines.push(`|---|${BUILD_VARIANTS.map(() => ':--:').join('|')}|`);
  for (const f of features) {
    lines.push(`| \`${f}\` | ${BUILD_VARIANTS.map((v) => cell(v, f)).join(' | ')} |`);
  }
  lines.push('');
  lines.push('## 3. 通道');
  lines.push('');
  lines.push(
    '| 变体 | 通道默认可用 | 依据 |'
  );
  lines.push('|---|:--:|---|');
  for (const v of BUILD_VARIANTS) {
    const spec = VARIANT_MATRIX[v];
    const dropped = spec.buildFeatures.includes('DROP_CHANNELS_ALL');
    lines.push(
      `| \`${v}\` | ${dropped ? '否（构建期整组剔除）' : '是'} | ${dropped ? '`buildFeatures: DROP_CHANNELS_ALL`' : '默认打包'} |`
    );
  }
  lines.push('');
  lines.push(
    '> 通道清单以 `packages/channels/src/channels/ChannelCatalog.ts` 为准；本表只表达"该变体是否打包通道"。'
  );
  lines.push('');
  return `${lines.join('\n')}`;
}

const expected = build();
const check = process.argv.includes('--check');

if (check) {
  let actual = '';
  try {
    actual = readFileSync(OUT, 'utf8');
  } catch {
    // @ignore-catch — 文件缺失按 drift 处理（fail-closed）
    actual = '';
  }
  if (actual !== expected) {
    console.error(
      `❌ 变体能力矩阵与实际事实源不一致：${OUT}\n   修复：cd app && bun run gen:variant-matrix-doc`
    );
    process.exit(1);
  }
  console.log('✅ 变体能力矩阵与 variant-matrix 事实源一致');
  process.exit(0);
}

writeFileSync(OUT, expected, 'utf8');
console.log(`✅ 已生成 ${OUT}`);
