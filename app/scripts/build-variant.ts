/**
 * build-variant.ts — 变体 **flags 生成**脚本（**不做编译**）
 *
 * ⚠️ 正名（G2，2026-10-11）：本脚本只做生成与复制，**不执行 TypeScript 编译 / 打包**。
 * 生成物 **全部落在宿主侧**（P2/P3 起不再写内核内的源文件）：
 *   ① `src/bootstrap/generatedVariantFlags.ts`（`BUILD_VARIANT_FLAGS`，变体默认层）；
 *   ② `src/bootstrap/generatedLazyLoaders.ts`（按需加载清单，未选中的模块连 `import()` 都不生成）；
 *   ③ `enterprise` 变体额外把 `.hbs` 模板复制到 `dist/`。
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
 * ⚠️ 接线：生成物由宿主入口（`bootstrap/initVariantFlags.ts` / `registerKernelLazyLoaders.ts`）
 * 在**最早期**推送进内核（三层优先：`FEATURE_*` env → 注入的变体层 → `FEATURE_FLAGS`）。
 * 注意：变体层是**构建期**产物；`LIRI_BUILD_VARIANT` 的**运行期**覆盖只影响 `getBuildVariant()`
 * （分版标识），**不**重新生成这些文件。
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

function parseArgs(): {
  variant: BuildVariant;
  dryRun: boolean;
  distTarget: string;
} {
  const args = process.argv.slice(2);
  let variant: BuildVariant = 'coding';
  let dryRun = false;
  /**
   * 发布产物根（企业版模板的落点）。
   *
   * 缺省 `app/dist` —— 即 `bun run build`（bundle 口径）的输出目录；
   * 编译口径由调用方显式给：`--dist-target=../dist`（与 `copy-prompts --target` 同口径，
   * 相对 **CWD**，因为构建脚本都从 `app/` 执行）。不显式给 ⇒ 行为与改造前一致。
   */
  let distTarget = path.resolve(__dirname, '..', 'dist');

  for (const arg of args) {
    if (arg.startsWith('--variant=')) {
      const v = arg.split('=')[1];
      if (BUILD_VARIANTS.includes(v as BuildVariant)) {
        variant = v as BuildVariant;
      } else {
        console.error(`无效的变体: ${v}，有效值: ${BUILD_VARIANTS.join(', ')}`);
        process.exit(1);
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--dist-target=')) {
      const target = arg.slice('--dist-target='.length).trim();
      if (!target) {
        console.error('--dist-target 需要非空目录');
        process.exit(1);
      }
      distTarget = path.resolve(target);
    }
  }

  return { variant, dryRun, distTarget };
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

/** 始终注册的按需加载器（模块 id → 说明符） */
const BASE_LAZY_LOADERS: ReadonlyArray<readonly [string, string]> = [
  ['featureflags', '@modules/featureflags'],
  ['memory', '@modules/memory'],
  ['chronos', '@modules/chronos'],
  ['lsp', '@modules/lsp'],
  ['mcp', '@modules/mcp'],
  ['security', '@modules/security'],
  ['sandbox', '@modules/sandbox'],
  ['voice', '@modules/voice'],
];

/** 仅在「未做 UI 裁剪」的变体里注册（`DROP_UI` ⇒ 连 import() 字面量都不生成） */
const UI_LAZY_LOADERS: ReadonlyArray<readonly [string, string]> = [
  ['ink', '@modules/ink'],
  ['ui', '@modules/ui'],
];

/**
 * 生成宿主侧**按需加载清单**（core 独立包 P2，2026-10-23）。
 *
 * 为什么由脚本生成而不是手写 + `if (feature('DROP_UI'))` 包裹：
 * `registerLazyLoader(...)` 是有副作用的调用，minifier 未必敢删整个 `if` body ⇒
 * `import('@modules/ink')` 可能仍留在产物图里。生成物则让未选中的条目**根本不存在**。
 */
function generateLazyLoaders(variant: BuildVariant): string {
  const config = VARIANT_CONFIGS[variant];
  const dropUi = config.buildFeatures.includes('DROP_UI');
  const entries = dropUi
    ? BASE_LAZY_LOADERS
    : [...BASE_LAZY_LOADERS, ...UI_LAZY_LOADERS];

  const lines: string[] = [];
  lines.push('// 自动生成的按需加载清单（core 独立包 P2）');
  lines.push(`// 变体: ${variant} — ${config.description}`);
  lines.push(`// 生成时间: ${new Date().toISOString()}`);
  lines.push('// 勿手改：由 app/scripts/build-variant.ts 按变体重写');
  lines.push('//');
  lines.push(
    '// 未选中的模块连 import() 字面量都不生成 ⇒ 变体裁剪不依赖 minifier 的副作用分析。'
  );
  lines.push(
    'export const LAZY_LOADERS: Record<string, () => Promise<unknown>> = {'
  );
  for (const [id, spec] of entries) {
    lines.push(`  ${id}: () => import('${spec}'),`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

/**
 * 输出该变体的**编译期裁剪**清单（P2，2026-10-20）。
 *
 * 本脚本**不编译**；这里只把该变体需要的 `bun build --feature=...` 参数打印出来，
 * 供构建脚本 / 人工核对 —— 避免"矩阵里声明了裁剪、构建命令却忘了带"。
 */
function printBuildFeatures(variant: BuildVariant): void {
  const features = VARIANT_CONFIGS[variant].buildFeatures;
  if (features.length === 0) {
    console.log('[编译期裁剪] 无（该变体不做物理剔除）');
    return;
  }
  console.log(
    `[编译期裁剪] 需在 bun build 追加: ${features
      .map((name) => `--feature=${name}`)
      .join(' ')}`
  );
}

function main(): void {
  const { variant, dryRun, distTarget } = parseArgs();

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
    console.log('\n将生成以下按需加载清单:');
    console.log(generateLazyLoaders(variant));
    printBuildFeatures(variant);
    return;
  }

  const flagsContent = generateFeatureFlags(variant);
  const outputPath = path.resolve(
    __dirname,
    '..',
    'src',
    'bootstrap',
    'generatedVariantFlags.ts'
  );

  fs.writeFileSync(outputPath, flagsContent, 'utf-8');
  console.log(`\nFeature Flags 已写入: ${outputPath}`);

  const loadersPath = path.resolve(
    __dirname,
    '..',
    'src',
    'bootstrap',
    'generatedLazyLoaders.ts'
  );
  fs.writeFileSync(loadersPath, generateLazyLoaders(variant), 'utf-8');
  console.log(`按需加载清单已写入: ${loadersPath}`);
  printBuildFeatures(variant);

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

  // 企业版：复制模板文件到发布产物根（`--dist-target`，缺省 `app/dist`）
  if (variant === 'enterprise') {
    copyTemplateFiles(distTarget);
    console.log(`企业版模板已复制到 ${distTarget}（仅此一步会写产物目录）`);
  }

  console.log('\n变体 flags 生成完成（未执行编译）。');
}

/**
 * 复制 .hbs 模板文件到发布产物根下的 `modules/doc/template/builtin`
 *
 * 确保 `TemplateEngine` 在运行时能读到模板（它在 bundle / compile 两种产物里都按
 * `<产物根>/modules/doc/template` 找 —— 见 `resolveDocTemplateDir`）。
 *
 * @param distRoot 产物根（bundle：`app/dist`；compile：`../dist`）
 */
function copyTemplateFiles(distRoot: string): void {
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
    distRoot,
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
