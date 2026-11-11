// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 细粒度 RBAC deny 的**归因标签**（2026-11-11，P2-5）。
 *
 * 背景：`checkFineGrainedRules` 会把角色 / 用户 / 资源三路规则合并后统一挑选，
 * 早期指标把命中一律记成「当前生效角色」⇒ 用户级或资源级 deny 在桌面端被记成
 * `role=admin`，排障时看不出到底是谁拦的。
 *
 * 归因口径（与规则的绑定形状一致，纯函数、零 IO）：
 * - 来自角色绑定 ⇒ `role:<roleId>`（`roleObj.permissions` 未带 roleId 时回落生效角色名）
 * - 来自用户绑定 ⇒ `user:<userId>`
 * - 来自资源绑定 ⇒ `resource:<resourceId>`（工具类资源即工具名）
 */

import type { PermissionRule } from './Permission';

/** 规则来自哪一路绑定（采集时打标，避免事后猜） */
export type FineGrainedDenySource = 'role' | 'user' | 'resource';

/**
 * 生成 deny 指标的主体标签（形如 `role:admin` / `user:alice` / `resource:bash`）。
 *
 * @param rule 命中的细粒度规则
 * @param source 该规则来自哪一路绑定
 * @param effectiveRole 本次判定的生效角色名（仅角色路的兜底，可为空）
 */
export function describeFineGrainedDenySubject(
  rule: Pick<PermissionRule, 'roleId' | 'userId' | 'resourceId'>,
  source: FineGrainedDenySource,
  effectiveRole?: string | null
): string {
  switch (source) {
    case 'user':
      return `user:${rule.userId ?? 'unknown'}`;
    case 'resource':
      return `resource:${rule.resourceId}`;
    case 'role':
      return `role:${rule.roleId ?? effectiveRole ?? 'unknown'}`;
  }
}
