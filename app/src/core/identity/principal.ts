/**
 * Principal — **请求级身份**载体（多租户 P0 · 阶段 1）
 *
 * 背景（`变体矩阵方案.md` §2.7 / 台账「用户隔离 / 服务端多租户」）：
 * PC 端自始单用户，`~/.pyapp` + OS 账户即隔离边界；服务端多租户需要把「用户」
 * **从进程属性降级为请求属性**。当前仓里有两个进程级钉子：
 *   - `ChatManager` 的 `_currentSessionId`（**阶段 2** 处理）
 *   - `PermissionManager` 的 `currentUserRole`（**阶段 1** 处理）
 *
 * 阶段 1 的口径（对 PC **零行为变更**）：
 *   - 本文件只提供**纯类型与纯函数**，不读请求、不碰存储；
 *   - `LOCAL_PRINCIPAL` 是桌面端默认身份（`tenantId='local'`、`userId='local'`）；
 *   - 权限判定侧只增加「请求级角色优先、缺失则回退进程级」这一条规则
 *     （`resolveEffectiveRole`）—— 既有调用方**不传**请求级角色 ⇒ 行为与改造前一致。
 *
 * 阶段 2（已完成，2026-10-21）：HTTP 鉴权结果 → `Principal` → 会话/工具执行链路。
 * 请求作用域实现见 `./requestScope.ts`（`AsyncLocalStorage`），HTTP 解析见
 * `infrastructure/http/requestIdentity.ts`；`_currentSessionId` 已按身份分桶。
 */

/** 请求级身份：租户（= 组织）+ 用户 + 角色 */
export interface Principal {
  /** 租户标识（= 组织）；PC 端恒 `'local'`（方案 §2.7 已裁定 `tenant = 组织`） */
  tenantId: string;
  userId: string;
  /**
   * 角色列表。**第一个元素是权限判定的主角色**（与 `PermissionContext.userRole` 对齐），
   * 其余为附加角色；空数组在规范化时回落为 `[userId]`，避免出现「无角色」的歧义态。
   */
  roles: string[];
}

export const LOCAL_TENANT_ID = 'local';
export const LOCAL_USER_ID = 'local';

/** 桌面端默认身份。只读语义：调用方不应原地修改，需要变体时走 `normalizePrincipal` */
export const LOCAL_PRINCIPAL: Principal = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  roles: [LOCAL_USER_ID],
};

/**
 * 规范化外部输入：空字符串 / 空白 / 缺失字段一律回落到本地身份；角色去空白、去空项。
 * 不做"猜身份" —— 缺失就是本地，不编造租户。
 */
export function normalizePrincipal(
  input?: Partial<Principal> | null
): Principal {
  const tenantId = input?.tenantId?.trim() || LOCAL_TENANT_ID;
  const userId = input?.userId?.trim() || LOCAL_USER_ID;
  const roles = (input?.roles ?? [])
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
  return {
    tenantId,
    userId,
    roles: roles.length > 0 ? roles : [userId],
  };
}

/**
 * 请求级角色优先，缺失则回退进程级角色。
 *
 * 这是阶段 1 **唯一**的语义变更点：`PermissionManager` 从「只读进程级 `currentUserRole`」
 * 改为「先看本次请求带来的角色，没有才看进程级」。
 * - 既有调用方不传请求级角色 ⇒ 结果与改造前**完全相同**（零行为变更）；
 * - 服务端并发请求各自带角色 ⇒ 不再互相覆盖（这正是「单例钉子」的问题）。
 */
export function resolveEffectiveRole(
  requestRole: string | null | undefined,
  processRole: string | null
): string | null {
  const trimmed = requestRole?.trim();
  return trimmed ? trimmed : processRole;
}

/** 把 Principal 映射到权限上下文（`PermissionContext` 只有 userId / userRole 两个身份位） */
export function principalToPermissionContext(principal: Principal): {
  userId: string;
  userRole: string;
} {
  return {
    userId: principal.userId,
    userRole: principal.roles[0] ?? principal.userId,
  };
}
