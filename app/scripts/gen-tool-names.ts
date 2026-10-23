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
// 变体层必须最先注入（同 export-tool-params.ts：顶层 `feature()` 会被 P3 时序守卫拦下）
import '../src/bootstrap/initVariantFlags';
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

async function main(): Promise<void> {
  const factory = new ToolFactory();
  const loaders = getAllBuiltinToolLoaders();
  const tools = loadTools(factory, loaders);
  const names = [...new Set(tools.map((t) => t.name))].sort();

  // 口径告警（2026-09-29，台账 D-40 / D-41；**2026-10-11 D11-B 后补"可列出名单"**）：生成物的口径
  // =「**全量 ∧ 可实例化**」——`getAllBuiltinToolLoaders()` 是"与 flag 无关的全量清单"，但 `loadTools()`
  // 会**真实调用工厂**，于是 **flag-gated 且默认关闭**的工具（工厂内 `isToolEnabled(...)` 为 false
  // ⇒ 返回 `null`）**不会进入生成物**。这不是漏报，而是该口径的**已知边界**。
  //
  // D11-B（用户裁定"全量常量表"）落地后，工具名已有**单一来源** `tools/toolNameConstants.ts`
  // ⇒ 该边界从"只能报条数"升级为"**可列出被排除名**"（台账 D-41 就此闭合）。
  const gatedOut = loaders.length - tools.length;
  const effective = new Set(names);
  const declaredNotEffective = Object.values(
    (
      await import('../src/tools/toolNameConstants.js')
    ).TOOL_NAME_CONSTANTS
  )
    .filter((n) => !effective.has(n))
    .sort();
  if (gatedOut > 0 || declaredNotEffective.length > 0) {
    console.warn(
      `[gen-tool-names] ⚠️ 清单 ${loaders.length} 条中有 ${gatedOut} 条加载器返回 null` +
        `（多为 flag-gated 且默认关闭者）⇒ 这些名字**不会**进入生成物（口径 = 「全量 ∧ 可实例化」）。` +
        `\n  被排除名（来自常量表，共 ${declaredNotEffective.length}）：${declaredNotEffective.join(', ') || '（无）'}` +
        `\n  见 D-40/D-41（已于 D11-B 起可由常量表列出）。`
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
    '// 事实源：`getAllBuiltinToolLoaders()` + `loadTools()`（真实实例化）',
    '// 口径 = 「**全量 ∧ 可实例化**」：flag-gated 且默认关闭的工具（工厂返回 null）**不在**此清单。',
    '// 被排除名**可**从 `tools/toolNameConstants.ts` 的常量表列出（D11-B，2026-10-11；台账 D-41 已闭合）。',
    '// 此类名字**不得**用于 `satisfies readonly ToolName[]`（typecheck 会判"不存在"）。',
    '// 生成命令：`bun run gen:toolnames`（脚本：`app/scripts/gen-tool-names.ts`）',
    '',
    '/** 内建工具名（编译期枚举源）—— **全量 ∧ 可实例化**（不含 flag-gated 且默认关闭者） */',
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

// D11-B（2026-10-11）：`main` 变为 async（需动态 import 常量表）⇒ 必须 **await** 后再 `process.exit`，
// 否则下面的 `process.exit(0)` 会在写出文件之前结束进程。
await main();

// 显式退出（`lint:exit` 门禁要求）：本脚本经依赖会拉起持有句柄的初始化
// （`ToolFactory` 实例化全部内建工具，读配置 / 路径），逻辑跑完后进程不会自行退出
// ⇒ 表现为"命令卡住不返回"。错误分支由未捕获异常自带 exit 1，无需显式处理。
process.exit(0);
