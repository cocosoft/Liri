/**
 * gen-tool-names.ts
 * 由**内建工具清单**生成编译期工具名枚举（P2-3）
 *
 * 事实源：`getAllBuiltinToolLoaders()`（**全量视图** —— 含"条件工具"、与 flag / 用户身份**无关**）
 * 产物：`src/constants/toolNames.generated.ts`（**提交到 Git**；勿手改）
 *
 * 用法：bun run scripts/gen-tool-names.ts
 * 或：  bun run gen:toolnames
 *
 * ⚠️ 本脚本会 `new ToolFactory()` 并实例化全部内建工具（读配置 / 路径），故须在**可用环境**下运行。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ToolFactory } from '../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../src/tools/utils/ToolManagerUtils';

const OUT_FILE = path.resolve(
  __dirname,
  '..',
  'src',
  'constants',
  'toolNames.generated.ts'
);

function main(): void {
  const factory = new ToolFactory();
  const loaders = getAllBuiltinToolLoaders();
  const tools = loadTools(factory, loaders);
  const names = [...new Set(tools.map((t) => t.name))].sort();

  // 口径告警（2026-09-29，台账 D-40 / D-41）：生成物的口径 =「**全量 ∧ 可实例化**」——
  // `getAllBuiltinToolLoaders()` 是"与 flag 无关的全量清单"，但 `loadTools()` 会**真实调用工厂**，
  // 于是 **flag-gated 且默认关闭**的工具（工厂内 `isToolEnabled(...)` 为 false ⇒ 返回 `null`）
  // **不会进入生成物**。这不是漏报，而是该口径的**已知边界**：此类名字**不能**用于
  // `as const satisfies readonly ToolName[]`（会被判"不存在"）。⇒ 在此**显式告警**让边界可观测。
  const gatedOut = loaders.length - tools.length;
  if (gatedOut > 0) {
    console.warn(
      `[gen-tool-names] ⚠️ 清单 ${loaders.length} 条中有 ${gatedOut} 条加载器返回 null` +
        `（多为 flag-gated 且默认关闭者）⇒ 这些名字**不会**进入生成物。` +
        `口径 = 「全量 ∧ 可实例化」，见台账 D-40。` +
        `（**名单无法在此列出** —— 加载器不携带名字元数据，见台账 D-41；` +
        `故此处只报**条数**，让该边界**可观测**。）`
    );
  }

  const duplicates =
    tools.length !== names.length
      ? tools.map((t) => t.name).filter((n, i, arr) => arr.indexOf(n) !== i)
      : [];
  if (duplicates.length > 0) {
    // 清单内出现同名工具 ⇒ 注册面缺陷（历史教训：见台账 D-29）
    console.warn(
      `[gen-tool-names] ⚠️ 清单中存在重复工具名（${[...new Set(duplicates)].join(', ')}）—— 请先修复注册面`
    );
  }

  const content = [
    '// ⚠️ 此文件由 `bun run gen:toolnames` **自动生成**，请勿手改。',
    '// 事实源：`getAllBuiltinToolLoaders()`（全量视图：含条件工具、与 flag 无关）',
    '// 生成命令：`bun run gen:toolnames`（脚本：`app/scripts/gen-tool-names.ts`）',
    '',
    '/** 内建工具名（编译期枚举源）—— **全量**：含"条件工具"（flag 未启用时运行期不可见者） */',
    'export const TOOL_NAMES = [',
    // D-136（2026-09-30）：此处必须输出**单引号** —— 工具名均为 `[a-z_0-9]+` 标识符 ⇒ 无需转义；
    // 原用 `JSON.stringify(n)` 产出双引号，与仓内 prettier（单引号）冲突 ⇒ 生成物天生不合规，
    // 每次重生都会被 pre-commit 的 `eslint --fix` 全量改写（实测 ~142 行 diff，来回震荡）。
    ...names.map((n) => `  '${n}',`),
    '] as const;',
    '',
    '/** 内建工具名联合类型 —— 写出不存在 / 拼错的工具名 ⇒ `bun run typecheck` 报错 */',
    'export type ToolName = (typeof TOOL_NAMES)[number];',
    '',
    '/** 生成时的工具名总数（门禁守卫用：与真实清单不符 ⇒ 需重新生成） */',
    `export const TOOL_NAMES_COUNT = ${names.length};`,
    '',
  ].join('\n');

  fs.writeFileSync(OUT_FILE, content, 'utf-8');
  console.log(
    `[gen-tool-names] 已写入 ${OUT_FILE}（${names.length} 个工具名）`
  );
}

main();
