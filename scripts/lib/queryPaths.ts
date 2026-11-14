/**
 * 查询引擎源码位置**单一事实源**（P0 拆包前置，2026-11-13）
 *
 * **背景**：`query` 的物理位置被多处各写一份 —— 源码守卫测试
 * （`budgetGate` / `dailyBudgetUsdGate` / `dbTaorCheckpointOwnerScope` / `queryLogOwnerScope` /
 * `verifierMetrics` / `stateMachineHygiene` / `backoffDefaults` / `sameNameConstsB2`）、
 * 文档一致性检查（`check-doc-code-consistency.js`）与 eval 任务定义（`source-derived`）。
 * 拆包（`app/src/query` → `packages/query/src/query`）时任一漏改都是 AR-3：
 * 脚本**响亮失败**（事实源不存在），而测试守卫可能**静默空转**（读不到文件 ⇒ 断言失真）。
 *
 * **本模块只回答"查询引擎源码在哪"**，不含业务逻辑；搬包时改本文件一处即可
 * （与 `scripts/lib/sandboxPaths.ts`、`channelPaths.ts`、`sessionPaths.ts` 同构）。
 */

import { join } from 'node:path';

/** 查询模块的仓库相对路径（POSIX 分隔，供以路径为键的台账/测试使用） */
export const QUERY_SRC_REL = 'packages/query/src/query';

/** 查询源码目录（绝对路径） */
export function querySrcDir(projectDir: string): string {
  return join(projectDir, 'packages', 'query', 'src', 'query');
}

/** 查询模块内的文件或目录（绝对路径）；`segments` 为查询目录内的相对片段 */
export function queryPath(projectDir: string, ...segments: string[]): string {
  return join(querySrcDir(projectDir), ...segments);
}

/** 查询模块内的文件或目录（仓库相对、`/` 分隔） */
export function queryRepoRel(...segments: string[]): string {
  return [QUERY_SRC_REL, ...segments].join('/');
}
