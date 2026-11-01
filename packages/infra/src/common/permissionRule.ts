/**
 * 权限行为枚举（`allow` / `deny` / `ask` / `passthrough`）
 *
 * 2026-11-01（B7 解环）：自 `permission/types/PermissionRule.ts` **下沉至叶子模块**。
 * 迁因：`security/PermissionManager.ts` 需要按 `PermissionBehavior.DENY` 判等，
 * 而 `permission` 又反向依赖 `security`（审计日志 / 规则表）⇒ `security ↔ permission`
 * 是 infra 内最后的两元环。枚举是**共享契约**、无任何行为，放叶子后两侧都只依赖 `common`；
 * `permission/types/PermissionRule.ts` 保留**同名转出**（导出面与取值逐字不变，
 * 因为「同名转出」转的是同一个 enum 对象 ⇒ 判等语义不变）。
 */
export enum PermissionBehavior {
  /** 允许使用工具 */
  ALLOW = 'allow',

  /** 拒绝使用工具 */
  DENY = 'deny',

  /** 询问是否使用工具 */
  ASK = 'ask',

  /** 透传（不拦截，放行） */
  PASSTHROUGH = 'passthrough',
}
