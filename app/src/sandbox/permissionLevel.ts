// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * permissionLevel — 沙箱**权限位**的单一事实源（2026-10-23 从 `sandboxExecutionSignal` 下沉）
 *
 * 为什么单独成文件：`WorkspaceManager` 建工作区时只需要"当前权限位"，但
 * `sandboxExecutionSignal` 还依赖 `workspaceIsolation → scopedDefaultWorkspace →
 * WorkspaceManager` ⇒ 形成 `WorkspaceManager → sandboxExecutionSignal → workspaceIsolation
 * → scopedDefaultWorkspace → WorkspaceManager` 的静态环（madge 实测 1 条）。
 * 把**只依赖 configManager** 的权限位解析下沉后，两个消费方各自引用本模块，环即消除。
 *
 * 口径（不变）：
 * - `full`（旧默认）= READ + WRITE + **EXECUTE**；
 * - `standard`（现默认，Q-30）= READ + WRITE（不含 EXECUTE）；
 * - `readonly` = READ；
 * - 未配置 / 非法值 ⇒ `standard`（不是 `full`，避免"写错一个字符就放宽到可执行"）。
 */

import { configManager } from '@modules/config';
import type { SandboxPermissionLevel } from '@modules/utils/toolContract/Tool';

/** 沙箱默认权限位（2026-10-23 用户拍板：`standard`） */
export const DEFAULT_SANDBOX_PERMISSION_LEVEL: SandboxPermissionLevel =
  'standard';

/** 合法权限位取值（与 HTTP handler 的白名单同域） */
export const SANDBOX_PERMISSION_LEVELS: readonly SandboxPermissionLevel[] = [
  'readonly',
  'standard',
  'full',
];

/**
 * 纯函数：把配置/环境原值规整为权限位。
 *
 * 未配置或取值非法 ⇒ **默认 `standard`**（不是 `full`）。
 */
export function resolveSandboxPermissionLevel(
  configured?: unknown,
  envDefault?: unknown
): SandboxPermissionLevel {
  const raw =
    typeof configured === 'string' && configured.trim() !== ''
      ? configured
      : envDefault;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (SANDBOX_PERMISSION_LEVELS as readonly string[]).includes(value)
    ? (value as SandboxPermissionLevel)
    : DEFAULT_SANDBOX_PERMISSION_LEVEL;
}

/** 读当前生效权限位：`config.json sandbox.permissionLevel` > 环境变量 > 默认 `standard` */
export function readSandboxPermissionLevel(): SandboxPermissionLevel {
  return resolveSandboxPermissionLevel(
    configManager.getValue<string>('sandbox.permissionLevel'),
    configManager.env(
      'PERMISSION_SANDBOX_DEFAULT',
      DEFAULT_SANDBOX_PERMISSION_LEVEL
    )
  );
}
