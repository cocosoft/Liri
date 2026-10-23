/**
 * lint-variant-matrix.ts — 变体矩阵门禁（P0，2026-10-20）
 *
 * 校验 `scripts/variant-matrix.ts`（**单一事实源**）自身是否自洽：
 *   ① 变体清单无重复、矩阵覆盖清单里的每个变体；
 *   ② 同一变体内 `features` 与 `excludeFeatures` **不相交**（同一开关不能既开又关）；
 *   ③ 两张清单内部无重复项（生成文件里重复键会被后者静默覆盖）；
 *   ④ 每个开关名都存在于 `src/core/featureFlags.ts` 的 `FEATURE_FLAGS`（防拼写漂移）；
 *   ⑤ `buildFeatures` 必须是 `DROP_*`（编译期裁剪的保留前缀）。
 *
 * ⚠️ 本门禁**不**校验宿主侧生成物 `src/bootstrap/generatedVariantFlags.ts` 与矩阵是否一致（P3 起生成物不再落在内核内）：
 *    它是**构建产物**（切变体即改写），把"产物陈旧"判成红灯只会制造噪声。
 *    "单一事实源"由结构保证 —— `build-variant.ts` 直接 import 本矩阵，不自带第二份定义。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BUILD_VARIANTS, VARIANT_MATRIX } from './variant-matrix';
import type { BuildVariant } from './variant-matrix';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const violations: string[] = [];

function fail(message: string): void {
  violations.push(message);
}

/** 从 `featureFlags.ts` 文本中提取 `FEATURE_FLAGS` 的键（唯一真源，不手写名单） */
function loadFeatureFlagNames(): Set<string> {
  // 内核已物理迁出 `app/src/core` ⇒ 仓库根 `packages/kernel/src/core`（方案 §4-P4）
  const file = path.resolve(
    __dirname,
    '..',
    '..',
    'packages',
    'kernel',
    'src',
    'core',
    'featureFlags.ts'
  );
  const source = fs.readFileSync(file, 'utf-8');
  const start = source.indexOf('export const FEATURE_FLAGS = {');
  if (start < 0) {
    throw new Error(
      '未在 featureFlags.ts 中找到 `export const FEATURE_FLAGS = {`'
    );
  }
  const end = source.indexOf('} as const;', start);
  if (end < 0) {
    throw new Error('未找到 `FEATURE_FLAGS` 对象的结束标记 `} as const;`');
  }
  const block = source.slice(start, end);
  const names = new Set<string>();
  for (const match of block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*:/gm)) {
    names.add(match[1]!);
  }
  return names;
}

/**
 * 读取 `tools/toolCategories.ts` 的「恒保留工具 → 能力前置」覆盖关系（K05）。
 *
 * 解析源码文本而非运行时 import：本门禁刻意不加载 `src/`（避免把工具面依赖拉进门禁），
 * 与 `loadFeatureFlagNames` 同手法。解析不到即为结构漂移 ⇒ 由调用方 fail（不静默）。
 */
function loadMandatoryCoverage(): {
  tools: string[];
  requires: Map<string, string>;
} {
  const file = path.resolve(
    __dirname,
    '..',
    'src',
    'tools',
    'toolCategories.ts'
  );
  const source = fs.readFileSync(file, 'utf-8');

  const setStart = source.indexOf('export const MANDATORY_TOOLS');
  const setEnd = setStart < 0 ? -1 : source.indexOf('])', setStart);
  if (setStart < 0 || setEnd < 0) {
    throw new Error(
      '未在 toolCategories.ts 中找到 `MANDATORY_TOOLS = new Set([…])`'
    );
  }
  const tools = [
    ...source.slice(setStart, setEnd).matchAll(/'([a-z0-9_]+)'/g),
  ].map((m) => m[1]!);

  const requiresStart = source.indexOf('export const MANDATORY_TOOL_REQUIRES');
  const requiresEnd =
    requiresStart < 0 ? -1 : source.indexOf('};', requiresStart);
  if (requiresStart < 0 || requiresEnd < 0) {
    throw new Error(
      '未在 toolCategories.ts 中找到 `MANDATORY_TOOL_REQUIRES = { … }`'
    );
  }
  const requires = new Map<string, string>();
  for (const m of source
    .slice(requiresStart, requiresEnd)
    .matchAll(/^\s*([a-z0-9_]+)\s*:\s*'([A-Z][A-Z0-9_]*)'/gm)) {
    requires.set(m[1]!, m[2]!);
  }

  return { tools, requires };
}

function checkDuplicates(list: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const name of list) {
    if (seen.has(name)) fail(`${label} 存在重复项: ${name}`);
    seen.add(name);
  }
}

/** 两个清单集合相等（顺序无关） */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((x) => setA.has(x));
}

function main(): void {
  console.log('=== 变体矩阵门禁（单一事实源） ===');

  // ① 清单与覆盖
  checkDuplicates(BUILD_VARIANTS, 'BUILD_VARIANTS');
  for (const variant of BUILD_VARIANTS) {
    if (!VARIANT_MATRIX[variant]) fail(`矩阵缺少变体定义: ${variant}`);
  }
  const extra = (Object.keys(VARIANT_MATRIX) as BuildVariant[]).filter(
    (variant) => !BUILD_VARIANTS.includes(variant)
  );
  if (extra.length > 0) fail(`矩阵存在未登记变体: ${extra.join(', ')}`);

  const knownFlags = loadFeatureFlagNames();
  if (knownFlags.size === 0) fail('FEATURE_FLAGS 键集合为空（解析失败）');

  for (const variant of BUILD_VARIANTS) {
    const spec = VARIANT_MATRIX[variant];
    if (!spec) continue;

    // ② 开/关不相交
    const excluded = new Set(spec.excludeFeatures);
    for (const name of spec.features) {
      if (excluded.has(name)) {
        fail(
          `[${variant}] 同一开关既在 features 又在 excludeFeatures: ${name}`
        );
      }
    }

    // ③ 内部无重复
    checkDuplicates(spec.features, `[${variant}] features`);
    checkDuplicates(spec.excludeFeatures, `[${variant}] excludeFeatures`);

    // ④ 开关名必须真实存在
    for (const name of [...spec.features, ...spec.excludeFeatures]) {
      if (!knownFlags.has(name)) {
        fail(`[${variant}] 开关名不在 FEATURE_FLAGS 中（拼写漂移?）: ${name}`);
      }
    }

    // ⑤ 编译期裁剪前缀
    for (const name of spec.buildFeatures) {
      if (!/^DROP_[A-Z0-9_]+$/.test(name)) {
        fail(`[${variant}] buildFeatures 必须使用 DROP_ 前缀: ${name}`);
      }
    }

    console.log(
      `  ${variant}: +${spec.features.length} / -${spec.excludeFeatures.length} / build:${spec.buildFeatures.length}`
    );
  }

  // ⑥ headless 策略（2026-10-20 用户裁定：能力面继承 personal；仅裁 UI；通道默认保留）
  const headless = VARIANT_MATRIX.headless;
  const personal = VARIANT_MATRIX.personal;
  if (headless && personal) {
    if (!headless.buildFeatures.includes('DROP_UI')) {
      fail('[headless] buildFeatures 必须含 DROP_UI');
    }
    if (headless.buildFeatures.includes('DROP_CHANNELS_ALL')) {
      fail(
        '[headless] 默认不得裁通道（裁定：通道默认打包，需要时由 CLI 追加 DROP_CHANNELS_ALL）'
      );
    }
    if (!sameSet(headless.features, personal.features)) {
      fail('[headless] features 必须与 personal 一致（裁定：继承 personal）');
    }
    if (!sameSet(headless.excludeFeatures, personal.excludeFeatures)) {
      fail(
        '[headless] excludeFeatures 必须与 personal 一致（裁定：继承 personal）'
      );
    }
    if (headless.minimalToolSurface) {
      fail('[headless] 不得启用 minimalToolSurface（那是 core 的 7 工具下限）');
    }
  }

  // ⑦ 恒保留工具必须声明**能力前置**（K05 修正版，2026-10-23）
  //
  // 建议稿的原口径是「MANDATORY_TOOLS ⊆ 当前变体 features」——**与实现相反**：
  // `core` 变体按设计排除 `AGENT` / `TODO`，而 `getMandatoryTools()` 正是按能力开关把
  // 对应工具从恒集里剔除（见 `toolCategories.ts` 该函数注释）。真正会复发的是另一件事：
  // 往 `MANDATORY_TOOLS` 加了工具却没在 `MANDATORY_TOOL_REQUIRES` 加前置 ⇒ 该工具
  // **恒可见且不受变体约束**（正是"变体裁掉、mandatory 又强制可见"的旧缺陷）。
  const coverage = loadMandatoryCoverage();
  if (coverage.tools.length === 0) {
    fail('[K05] 无法解析 MANDATORY_TOOLS（源文件结构漂移?）');
  }
  for (const tool of coverage.tools) {
    if (!coverage.requires.has(tool)) {
      fail(`[K05] 恒保留工具缺少能力前置（会绕开变体收敛）: ${tool}`);
    }
  }
  for (const [tool, flag] of coverage.requires) {
    if (!knownFlags.has(flag)) {
      fail(`[K05] 能力前置开关不在 FEATURE_FLAGS 中: ${tool} → ${flag}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\n❌ 变体矩阵存在 ${violations.length} 条违规:`);
    for (const item of violations) console.error(`  - ${item}`);
    process.exit(1);
  }

  console.log(
    `\n✅ 变体矩阵自洽（${BUILD_VARIANTS.length} 个变体，开关词汇表 ${knownFlags.size} 项）`
  );
}

main();
