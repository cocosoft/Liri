/**
 * 沙箱源码位置**单一事实源**（P0 拆包前置，2026-11-12）
 *
 * **背景**：`app/src/sandbox` 的物理位置一直被多处各写一份 —— 构建 C helper 的脚本
 * （`build-win-sandbox` / `build-landlock-helper`）、CI 内联 `cc`、策略漂移对拍
 * （`lint-policy-drift`）、权限唯一来源豁免键（`lint-permission-single-source`）。
 *
 * 拆包（`app/src/sandbox` → `packages/sandbox/src/sandbox`）时任一漏改，都是
 * AR-3「门禁不得因搬目录而静默失焦」：其中前两者**响亮失败**（编译/读取不到文件），
 * 后两者会**静默放行**（基线为空 / 豁免键失配）。
 *
 * **本模块只回答"沙箱源码在哪"**，不含构建与校验逻辑；搬包时改本文件一处即可。
 */

import { join } from 'node:path';

/** 沙箱模块的仓库相对路径（POSIX 分隔，供以路径为键的台账/豁免表使用） */
export const SANDBOX_SRC_REL = 'app/src/sandbox';

/** 沙箱源码目录（绝对路径） */
export function sandboxSrcDir(projectDir: string): string {
  return join(projectDir, 'app', 'src', 'sandbox');
}

/** 沙箱内的文件或目录（绝对路径）；`segments` 为沙箱目录内的相对片段 */
export function sandboxPath(projectDir: string, ...segments: string[]): string {
  return join(sandboxSrcDir(projectDir), ...segments);
}

/** 沙箱内的文件或目录（仓库相对、`/` 分隔） */
export function sandboxRepoRel(...segments: string[]): string {
  return [SANDBOX_SRC_REL, ...segments].join('/');
}
