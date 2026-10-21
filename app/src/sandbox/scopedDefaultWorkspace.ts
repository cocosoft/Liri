/**
 * scopedDefaultWorkspace — 默认工作区按**请求身份**解析（多租户 P3 收口）
 *
 * **问题**：`spiWiring` 在启动期用 `process.cwd()` 建了一个 `'default'` 工作区 ——
 * 这是**进程级**对象。已认证用户的沙箱权限判定（`hasWorkspacePermission` /
 * `isWorkspacePermissionDenied`）与状态查询都读它 ⇒ 租户用的是**宿主机的工作目录**与
 * 宿主那套默认权限，且所有租户共用同一实例。
 *
 * **口径**（与 `core/paths#resolveScopedWorkspaceRoot` 完全一致）：
 * - 本地身份（桌面 / CLI / cron / 无作用域）⇒ 仍是启动期那个 `'default'`（**零变更**）；
 * - 已认证身份 ⇒ `default@<tenantId>:<userId>`，工作目录 = 该身份的
 *   `<scoped>/workspace`，**绝不回落到宿主机项目根**。
 *
 * **惰性建**：权限判定是同步热路径（拿不到 `await`），故用
 * `WorkspaceManager.createSync()`（适配器创建无 IO，见其文档）。
 */

import { resolveScopedWorkspaceRoot } from '@modules/core/paths';
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '@modules/core/identity/requestScope.js';
import type { WorkspaceBase } from './WorkspaceBase.js';
import { globalWorkspaceManager } from './WorkspaceManager.js';

/** 本地身份的默认工作区 id（启动期由 `entrypoints/spiWiring` 创建） */
export const LOCAL_DEFAULT_WORKSPACE_ID = 'default';

/**
 * 当前请求身份对应的默认工作区 id
 *
 * 命名带 `@` 前缀段：与用户可能自建的 id 区分，且日志里一眼能看出"这是身份分区的工作区"。
 */
export function scopedDefaultWorkspaceId(): string {
  const principal = getRequestPrincipal();
  return isLocalPrincipal(principal)
    ? LOCAL_DEFAULT_WORKSPACE_ID
    : `${LOCAL_DEFAULT_WORKSPACE_ID}@${principalKeyOf(principal)}`;
}

/**
 * 取当前身份的默认工作区（**惰性创建**）
 *
 * - 本地身份：只查不建 —— 缺失时返回 `undefined`，保留启动装配"未建工作区"的既有语义
 *   （端口据此走 fail-closed / 放行两条既有分支，行为零变更）；
 * - 已认证身份：缺失即建（工作目录 = 该身份的工作区根）。
 */
export function getScopedDefaultWorkspace(): WorkspaceBase | undefined {
  const id = scopedDefaultWorkspaceId();
  const existing = globalWorkspaceManager.get(id);
  if (existing) return existing;
  if (id === LOCAL_DEFAULT_WORKSPACE_ID) return undefined;
  return globalWorkspaceManager.createSync(id, {
    workingDirectory: resolveScopedWorkspaceRoot(),
  });
}

/**
 * 当前身份可见的工作区数量（替代 `list().size`）
 *
 * `list()` 是**全进程**的 Map：已认证用户从它读到的数量里混着宿主与其他租户的实例
 * ⇒ `/v1/sandbox/status` 会泄露"这台机器上还有几个工作区"。
 *
 * 已认证身份返回 0/1（自己的默认工作区，首次读取时惰性建立，与权限判定同口径）；
 * 本地身份保持既有口径（进程内全部工作区）。
 */
export function scopedActiveWorkspaceCount(): number {
  if (isLocalPrincipal()) return globalWorkspaceManager.list().size;
  return getScopedDefaultWorkspace() ? 1 : 0;
}
