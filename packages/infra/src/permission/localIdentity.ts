// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 权限**判定身份位**（2026-11-11 用户裁定「本地视为 admin」）。
 *
 * 背景：细粒度 RBAC（`roles.json` / `users.json` / `rules.json`）接入判定链后，
 * `PermissionManager.handleDefault / handleAuto / handleDontAsk` 需要两个身份位：
 * - `userId`：用户级绑定（`users.json` 的角色/规则）的唯一依据；
 * - `userRole`：角色级绑定（`roles.json`）的唯一依据。
 *
 * 但 `getRequestPermissionRole()` 对本地身份返回 `null`（桌面未登录 ⇒ 无权限角色），
 * 而桌面端没有 "admin 登录" 这一步 ⇒ 角色绑定在桌面**永远命中不到**。
 *
 * 裁定：**本地身份在权限判定里就是 owner（admin）**；已认证身份仍取 `roles[0]`。
 * 注意这只影响**判定**，不改变 `getRequestPermissionRole()`（归属/审计口径不变）。
 *
 * 为什么落 infra 而非 kernel：kernel 有内核体量棘轮（`lint:kernel` K08），
 * 该映射是**权限域**语义（与 `PermissionManager` 同层），放这里更贴合分层。
 */

import {
  getRequestPrincipal,
  isLocalPrincipal,
} from '@openliri/kernel/identity/requestScope';

/** 本地身份在 RBAC 判定中使用的角色（桌面即 owner） */
export const LOCAL_PERMISSION_ROLE = 'admin';

/**
 * 权限判定用角色：本地身份 ⇒ `admin`；已认证 ⇒ `roles[0]`（空则 `null`，不臆造）。
 */
export function getEffectivePermissionRole(): string | null {
  const principal = getRequestPrincipal();
  if (isLocalPrincipal(principal)) return LOCAL_PERMISSION_ROLE;
  return principal.roles[0]?.trim() || null;
}
