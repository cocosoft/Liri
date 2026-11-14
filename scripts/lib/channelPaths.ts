/**
 * 通道源码位置**单一事实源**（P0 拆包前置，2026-11-13）
 *
 * **背景**：`channels` 的物理位置被多处各写一份 —— 生成脚本（`gen-status` / `gen-support-levels`）、
 * 凭据迁移脚本（`migrate-channel-credentials`）。拆包（`app/src/channels` →
 * `packages/channels/src/channels`）时任一漏改都是 AR-3「门禁不得因搬目录而静默失焦」：
 * 生成脚本会**响亮失败**（事实源不存在 ⇒ fail-closed），但凭据脚本的相对导入会直接断链。
 *
 * **本模块只回答"通道源码在哪"**，不含计数与生成逻辑；搬包时改本文件一处即可
 * （与 `scripts/lib/sandboxPaths.ts` 同构）。
 */

import { join } from 'node:path';

/** 通道模块的仓库相对路径（POSIX 分隔，供以路径为键的台账/豁免表使用） */
export const CHANNEL_SRC_REL = 'packages/channels/src/channels';

/** 通道源码目录（绝对路径） */
export function channelSrcDir(projectDir: string): string {
  return join(projectDir, 'packages', 'channels', 'src', 'channels');
}

/** 通道内的文件或目录（绝对路径）；`segments` 为通道目录内的相对片段 */
export function channelPath(projectDir: string, ...segments: string[]): string {
  return join(channelSrcDir(projectDir), ...segments);
}

/** 通道内的文件或目录（仓库相对、`/` 分隔） */
export function channelRepoRel(...segments: string[]): string {
  return [CHANNEL_SRC_REL, ...segments].join('/');
}
