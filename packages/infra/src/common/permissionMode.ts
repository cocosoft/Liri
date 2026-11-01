/**
 * 权限模式的**值域契约**（`PERMISSION_MODES` / `PermissionMode` 类型与 const 对象）
 *
 * 2026-11-01（B7 解环）：自 `permission/PermissionMode.ts` **下沉至叶子模块**。
 * 迁因：`security/CompleteSecuritySystem.ts`（类型）与 `security/SecurityIntegration.ts`
 * （运行时常量）都需要它，而 `permission` 又反向依赖 `security` ⇒ `security ↔ permission`
 * 是 infra 内最后的两元环。值域本身零行为、零依赖，属于共享契约；
 * `permission/PermissionMode.ts` 保留**同名转出**（含中文名/符号映射与描述函数）。
 */
export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypass',
  'dontAsk',
  'auto',
  'ask',
  'alwaysAsk',
  'strict',
] as const;

/** 权限模式字符串联合类型 */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** 权限模式 const 对象（枚举式访问） */
export const PermissionMode = {
  DEFAULT: 'default',
  ACCEPT_EDITS: 'acceptEdits',
  PLAN: 'plan',
  BYPASS: 'bypass',
  DONT_ASK: 'dontAsk',
  AUTO: 'auto',
  ASK: 'ask',
  ALWAYS_ASK: 'alwaysAsk',
  STRICT: 'strict',
} as const satisfies Record<string, PermissionMode>;
