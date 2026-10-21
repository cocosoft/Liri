/**
 * RequestScope — **请求级身份作用域**（多租户 P0 · 阶段 2）
 *
 * 背景（`变体矩阵方案.md` §2.7 / 台账「用户隔离 / 服务端多租户」）：
 * 阶段 1 只提供了 `Principal` 纯类型与「请求级角色优先」的判定规则，但**没有任何地方
 * 真正把请求身份传下去** —— `auth-handlers` 登录时仍写进程级单例
 * （`PermissionManager.setCurrentUserRole`），并发登录会互相覆盖。
 *
 * 阶段 2 补的就是这一段：HTTP 入口按请求解析出 `Principal`，用 `AsyncLocalStorage`
 * 建立**请求作用域**，让下游（会话当前 id、工具权限判定）按请求身份取值。
 *
 * 三条硬约束：
 *   1. **桌面端零行为变更** —— 无登录态 / 不在 HTTP 请求内（CLI、REPL、cron、后台任务）
 *      一律得到 `LOCAL_PRINCIPAL`，与改造前「进程级单值」等价；
 *   2. **不臆造身份** —— 缺失就是本地身份，不猜租户、不猜角色；
 *   3. **本模块不做 IO** —— 只持有作用域，解析输入由 HTTP 层负责（见
 *      `infrastructure/http/requestIdentity.ts`）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  LOCAL_PRINCIPAL,
  LOCAL_TENANT_ID,
  LOCAL_USER_ID,
  type Principal,
} from './principal.js';

const storage = new AsyncLocalStorage<Principal>();

/** 身份分桶键：`<tenantId>:<userId>`（会话当前 id、按身份隔离的内存态都以它为键） */
export function principalKeyOf(principal: Principal): string {
  return `${principal.tenantId}:${principal.userId}`;
}

/** 在指定身份下执行（HTTP 入口每个请求一次）；同步/异步回调均继承该身份 */
export function runWithPrincipal<T>(principal: Principal, fn: () => T): T {
  return storage.run(principal, fn);
}

/**
 * 当前请求身份。不在任何请求作用域内 ⇒ `LOCAL_PRINCIPAL`
 * （CLI / REPL / cron / 后台任务 / 单测默认路径）。
 */
export function getRequestPrincipal(): Principal {
  return storage.getStore() ?? LOCAL_PRINCIPAL;
}

/** 当前请求身份的分桶键 */
export function getRequestPrincipalKey(): string {
  return principalKeyOf(getRequestPrincipal());
}

/** 是否桌面本地身份（无登录态 / 不在请求作用域内） */
export function isLocalPrincipal(
  principal: Principal = getRequestPrincipal()
): boolean {
  return (
    principal.tenantId === LOCAL_TENANT_ID && principal.userId === LOCAL_USER_ID
  );
}

/**
 * 请求级权限角色。
 *
 * - 本地身份 ⇒ `null`：**不把 `'local'` 这个伪角色当权限角色回灌** —— 桌面端与改造前
 *   完全一致（此前 `PermissionContext.userRole` 就是缺省的，由进程级角色兜底）；
 * - 已认证身份 ⇒ `roles[0]`（`Principal` 约定的主角色）。
 */
export function getRequestPermissionRole(): string | null {
  const principal = getRequestPrincipal();
  if (isLocalPrincipal(principal)) return null;
  return principal.roles[0]?.trim() || null;
}
