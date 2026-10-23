// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * isolatedFileIo — 文件类工具「经沙箱执行」的适配层（方案 A，2026-10-23）
 *
 * 判定与端口的唯一来源是 `@modules/sandbox` 的 `resolveWorkspaceFileIo()`：
 * 只有"隔离适配器 + 宿主↔环境挂载映射"同时成立才返回端口。本模块只做一件事 ——
 * 把工具**已解析好的宿主绝对路径**翻译成环境内绝对路径，并给出该端口。
 *
 * 调用约定：
 * - 返回 `null` ⇒ 调用方**保持既有宿主直写**（零行为变更；该路径也不会被沙箱豁免，
 *   `sandboxExemption` 的 S4 会按"是否在工作区内"判定）；
 * - 返回非 `null` ⇒ 读写都必须走 `io`（宿主 `node:fs` 不得参与，否则"隔离"是假的）。
 */

import { resolveWorkspaceFileIo } from '@modules/sandbox';
import type { WorkspaceFileIo } from '@modules/sandbox';

export interface IsolatedFileTarget {
  /** 工具解析出的宿主绝对路径（**回执仍用它**，模型看到的位置不变） */
  hostPath: string;
  /** 隔离环境内的绝对路径（读写实际落点） */
  isolatedPath: string;
  io: WorkspaceFileIo;
}

/**
 * 解析本次文件操作的隔离目标。
 *
 * @param hostAbsPath 已解析的宿主绝对路径（`resolveFilePath()` 的输出）
 * @returns `null` = 无隔离工作区 / 路径不在工作区内 ⇒ 宿主直写
 */
export function resolveIsolatedFileTarget(
  hostAbsPath: string
): IsolatedFileTarget | null {
  const io = resolveWorkspaceFileIo();
  if (!io) return null;
  const isolatedPath = io.toIsolatedPath(hostAbsPath);
  if (!isolatedPath) return null;
  return { hostPath: hostAbsPath, isolatedPath, io };
}
