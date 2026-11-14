/**
 * 技能系统源码位置**单一事实源**（P0 拆包前置，2026-11-13）
 *
 * **背景**：`skills` 的物理位置被源码守卫测试各写一份（`sameNameConstsB2` 等）。
 * 拆包（`app/src/skills` → `packages/skills/src/skills`）时漏改即 AR-3：
 * 守卫读不到文件 ⇒ 断言**静默失真**（而非响亮失败）。
 *
 * **本模块只回答"技能源码在哪"**，不含业务逻辑；搬包时改本文件一处即可
 * （与 `scripts/lib/sandboxPaths.ts`、`channelPaths.ts`、`sessionPaths.ts`、`queryPaths.ts` 同构）。
 */

import { join } from 'node:path';

/** 技能模块的仓库相对路径（POSIX 分隔，供以路径为键的台账/测试使用） */
export const SKILL_SRC_REL = 'packages/skills/src/skills';

/** 技能源码目录（绝对路径） */
export function skillSrcDir(projectDir: string): string {
  return join(projectDir, 'packages', 'skills', 'src', 'skills');
}

/** 技能模块内的文件或目录（绝对路径）；`segments` 为技能目录内的相对片段 */
export function skillPath(projectDir: string, ...segments: string[]): string {
  return join(skillSrcDir(projectDir), ...segments);
}

/** 技能模块内的文件或目录（仓库相对、`/` 分隔） */
export function skillRepoRel(...segments: string[]): string {
  return [SKILL_SRC_REL, ...segments].join('/');
}
