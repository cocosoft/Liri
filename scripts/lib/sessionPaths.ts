/**
 * 会话源码位置**单一事实源**（P1 拆包前置，2026-11-13）
 *
 * **背景**：`session` 的物理位置被多处各写一份 —— 生成/维护脚本
 * （`prune-event-thinking` / `split-session-events` / `bench-*`）、源码守卫测试
 * （`sameNameConstsB2` / `eventTypeParity` / `inboundAttachmentBudget`）。
 * 拆包（`app/src/session` → `packages/service/src/session`）时任一漏改都是 AR-3：
 * 脚本**响亮失败**（导入断链），测试守卫则可能**静默空转**（读不到文件 ⇒ 断言失真）。
 *
 * **本模块只回答"会话源码在哪"**，不含业务逻辑；搬包时改本文件一处即可
 * （与 `scripts/lib/sandboxPaths.ts`、`channelPaths.ts` 同构）。
 */

import { join } from 'node:path';

/** 会话模块的仓库相对路径（POSIX 分隔，供以路径为键的台账/测试使用） */
export const SESSION_SRC_REL = 'packages/service/src/session';

/** 会话源码目录（绝对路径） */
export function sessionSrcDir(projectDir: string): string {
  return join(projectDir, 'packages', 'service', 'src', 'session');
}

/** 会话内的文件或目录（绝对路径）；`segments` 为会话目录内的相对片段 */
export function sessionPath(projectDir: string, ...segments: string[]): string {
  return join(sessionSrcDir(projectDir), ...segments);
}

/** 会话内的文件或目录（仓库相对、`/` 分隔） */
export function sessionRepoRel(...segments: string[]): string {
  return [SESSION_SRC_REL, ...segments].join('/');
}
