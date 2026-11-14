/**
 * Token 预算子系统源码位置**单一事实源**（P0 拆包前置，2026-11-13）
 *
 * **背景**：`tokenBudget` 的物理位置被源码守卫测试各写一份（`sameNameConstsB2` 等）。
 * 拆包（`app/src/tokenBudget` → `packages/tokenBudget/src/tokenBudget`）时漏改即 AR-3：
 * 守卫读不到文件 ⇒ 断言**静默失真**（而非响亮失败）。
 *
 * **本模块只回答"Token 预算源码在哪"**，不含业务逻辑；搬包时改本文件一处即可
 * （与 `scripts/lib/{sandbox,channel,session,query,skill}Paths.ts` 同构）。
 */

import { join } from 'node:path';

/** 预算模块的仓库相对路径（POSIX 分隔，供以路径为键的台账/测试使用） */
export const TOKEN_BUDGET_SRC_REL = 'packages/tokenBudget/src/tokenBudget';

/** 预算源码目录（绝对路径） */
export function tokenBudgetSrcDir(projectDir: string): string {
  return join(projectDir, 'packages', 'tokenBudget', 'src', 'tokenBudget');
}

/** 模块内的文件或目录（绝对路径）；`segments` 为目录内的相对片段 */
export function tokenBudgetPath(
  projectDir: string,
  ...segments: string[]
): string {
  return join(tokenBudgetSrcDir(projectDir), ...segments);
}

/** 模块内的文件或目录（仓库相对、`/` 分隔） */
export function tokenBudgetRepoRel(...segments: string[]): string {
  return [TOKEN_BUDGET_SRC_REL, ...segments].join('/');
}
