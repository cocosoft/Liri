/**
 * storageScope — **身份化存储作用域**（多租户 P1 存储分区）
 *
 * 目标（`变体矩阵方案.md` §2.7.3 P1）：非本地身份的数据落在
 * `<data>/tenants/<tenantId>/users/<userId>/…`，本地身份（桌面 / CLI / 后台）**路径完全不变**。
 *
 * 三条硬约束：
 *   1. **本地零变更** —— `isLocalPrincipal` ⇒ 返回原数据根，既有数据与既有测试不受影响；
 *   2. **路径注入防护** —— 租户/用户标识来自外部（注册用户名），必须经 `safePathSegment`
 *      规范化，禁止 `..`、分隔符、空段；
 *   3. **本模块纯函数、无 IO、不读 env** —— 基目录由调用方（`core/paths.ts`）传入。
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { isLocalPrincipal } from '@openliri/kernel/identity/requestScope';
import type { Principal } from '@openliri/kernel/identity/principal';

/** 允许直接作为路径段的安全字符集（与常见用户名/租户 slug 兼容） */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * 把外部标识转成**单个**安全路径段。
 *
 * 合法（`[A-Za-z0-9._-]{1,64}` 且不是 `.` / `..`）⇒ 原样使用，保持目录可读；
 * 否则 ⇒ `h_<sha256 前 16 位>`。后者是**确定性哈希**而非丢弃：同一标识永远映射到同一目录，
 * 且不同标识几乎不可能碰撞（64 bit）。
 */
export function safePathSegment(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (
    SAFE_SEGMENT.test(trimmed) &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  ) {
    return trimmed;
  }
  const digest = createHash('sha256').update(trimmed, 'utf8').digest('hex');
  return `h_${digest.slice(0, 16)}`;
}

/**
 * 计算该身份的数据根：本地身份 ⇒ `baseDataDir`（原样）；否则 ⇒
 * `join(baseDataDir, 'tenants', tenant, 'users', user)`。
 */
export function scopedDataRoot(
  baseDataDir: string,
  principal: Principal
): string {
  if (isLocalPrincipal(principal)) return baseDataDir;
  return join(
    baseDataDir,
    'tenants',
    safePathSegment(principal.tenantId),
    'users',
    safePathSegment(principal.userId)
  );
}

/** 该身份是否落在分区目录（＝非本地身份）；供调用方决定"是否扫描兼容根" */
export function isPartitionedScope(principal: Principal): boolean {
  return !isLocalPrincipal(principal);
}

/**
 * 计算该身份的**租户级**数据根：本地身份 ⇒ `baseDataDir`（原样）；否则 ⇒
 * `join(baseDataDir, 'tenants', tenant)` —— **不含 `users/<user>`**。
 *
 * 与 `scopedDataRoot` 的分工（基础设施专项 §6.1，2026-10-24 拍板"租户级 DB"）：
 * - `scopedDataRoot`（per-user）继续用于**必须按用户物理隔离**的资产（工作区等）；
 * - `tenantScopedDataRoot`（per-tenant）用于**租户内按 `owner_key` 行级隔离**的数据库。
 */
export function tenantScopedDataRoot(
  baseDataDir: string,
  principal: Principal
): string {
  if (isLocalPrincipal(principal)) return baseDataDir;
  return join(baseDataDir, 'tenants', safePathSegment(principal.tenantId));
}
