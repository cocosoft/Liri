/**
 * build-variant.ts — 变体 **flags 生成**脚本（**不做编译**）
 *
 * ⚠️ 正名（G2，2026-10-11）：本脚本**只**做两件事 ——
 *   ① 按变体定义写出 `src/core/buildVariantFlags.ts`（`BUILD_VARIANT_FLAGS`）；
 *   ② `enterprise` 变体额外把 `.hbs` 模板复制到 `dist/`。
 * 它**不执行 TypeScript 编译 / 打包**（原输出"执行 TypeScript 编译…/构建完成/输出目录 dist/"
 * 名不副实）。实际构建请用项目常规构建命令（如 `bun run build`）。
 *
 * 用法:
 *   bun run scripts/build-variant.ts --variant=core
 *   bun run scripts/build-variant.ts --variant=personal
 *   bun run scripts/build-variant.ts --variant=coding
 *   bun run scripts/build-variant.ts --variant=enterprise
 *
 * 环境变量:
 *   LIRI_BUILD_VARIANT=core|personal|coding|enterprise
 *
 * ⚠️ 已接线（D1，2026-10-11 用户裁定「接线」）：`BUILD_VARIANT_FLAGS` 现由 `core/featureFlags.ts`
 * 的 `feature()` 作为**中间层**消费（三层优先：`FEATURE_*` env → `BUILD_VARIANT_FLAGS` → `FEATURE_FLAGS`）
 * ⇒ 本脚本生成的变体开关**真正生效**。注意：变体层是**构建期**产物；`LIRI_BUILD_VARIANT` 的**运行期**
 * 覆盖只影响 `getBuildVariant()`（分版标识），**不**重新生成本文件。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BUILD_VARIANTS, VARIANT_MATRIX } from './variant-matrix';
import type { BuildVariant } from './variant-matrix';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 变体矩阵**单一事实源**在 `./variant-matrix.ts`；本文件只做"读表 → 生成 flags"，
// 不再自带第二份变体定义（防漂移，2026-10-20 P0）。
const VARIANT_CONFIGS = VARIANT_MATRIX;


function parseArgs(): { variant: BuildVariant; dryRun: boolean } {
  const args = process.argv.slice(2);
  let variant: BuildVariant = 'coding';
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--variant=')) {
      const v = arg.split('=')[1];
      if (BUILD_VARIANTS.includes(v as BuildVariant)) {
        variant = v as BuildVariant;
      } else {
        console.error(
          `无效的变体: ${v}，有效值: ${BUILD_VARIANTS.join(', ')}`
        );
        process.exit(1);
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { variant, dryRun };
}

function generateFeatureFlags(variant: BuildVariant): string {
  const config = VARIANT_CONFIGS[variant];

  const lines: string[] = [];
  lines.push('// 自动生成的分版 Feature Flags');
  lines.push(`// 变体: ${variant} — ${config.description}`);
  lines.push(`// 生成时间: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('export const BUILD_VARIANT_FLAGS = {');

  for (const feature of config.features) {
    lines.push(`  ${feature}: true,`);
  }

  for (const feature of config.excludeFeatures) {
    lines.push(`  ${feature}: false,`);
  }

  // 变体标记（非能力开关）：core ⇒ 工具装配点收敛为 7 项（见 tools/utils/ToolManagerUtils.ts）
  lines.push(`  CORE_MINIMAL: ${config.minimalToolSurface === true},`);

  lines.push('} as const;');
  lines.push('');

  return lines.join('\n');
}

function main(): void {
  const { variant, dryRun } = parseArgs();

  console.log(`\n=== Liri 变体 flags 生成（不做编译）===`);
  console.log(`变体: ${variant}`);
  console.log(`描述: ${VARIANT_CONFIGS[variant].description}`);
  console.log(`启用功能: ${VARIANT_CONFIGS[variant].features.length} 个`);
  console.log(
    `禁用功能: ${VARIANT_CONFIGS[variant].excludeFeatures.length} 个`
  );

  if (dryRun) {
    console.log('\n[DRY RUN] 只打印，不写文件');
    console.log('\n将生成以下 Feature Flags:');
    console.log(generateFeatureFlags(variant));
    return;
  }

  const flagsContent = generateFeatureFlags(variant);
  const outputPath = path.resolve(
    __dirname,
    '..',
    'src',
    'core',
    'buildVariantFlags.ts'
  );

  fs.writeFileSync(outputPath, flagsContent, 'utf-8');
  console.log(`\nFeature Flags 已写入: ${outputPath}`);

  // G2 正名（2026-10-11）：原输出"执行 TypeScript 编译…/构建完成/输出目录 dist/"名不副实 ——
  // 本脚本**不编译**。此处的 `LIRI_BUILD_VARIANT` 仅设置于**本进程**，不会影响后续的构建命令。
  console.log(
    '\n[正名] 本脚本只生成上述 flags 文件，**不做 TypeScript 编译 / 打包**。'
  );
  // 保留原行为（本进程内设置；对**后续**构建命令无效 —— 它们各自独立进程）
  process.env['LIRI_BUILD_VARIANT'] = variant;
  console.log(
    `[正名] 已设置本进程 LIRI_BUILD_VARIANT=${variant}（仅本进程有效；实际构建请另行执行 bun run build）`
  );

  // 企业版：复制模板文件到 dist/
  if (variant === 'enterprise') {
    copyTemplateFiles();
    console.log('企业版模板已复制到 dist/（仅此一步会写 dist/）');
  }

  console.log('\n变体 flags 生成完成（未执行编译）。');
}

/**
 * 复制 .hbs 模板文件到 dist/ 目录
 * 确保 TemplateEngine 在运行时能读取模板
 */
function copyTemplateFiles(): void {
  const srcDir = path.resolve(
    __dirname,
    '..',
    'src',
    'modules',
    'doc',
    'template',
    'builtin'
  );
  const distDir = path.resolve(
    __dirname,
    '..',
    'dist',
    'modules',
    'doc',
    'template',
    'builtin'
  );

  if (!fs.existsSync(srcDir)) {
    console.log('模板源目录不存在，跳过复制');
    return;
  }

  fs.mkdirSync(distDir, { recursive: true });

  copyDirSync(srcDir, distDir);
  console.log(`模板文件已复制: ${srcDir} → ${distDir}`);
}

/**
 * 递归复制目录内容
 */
function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

main();
