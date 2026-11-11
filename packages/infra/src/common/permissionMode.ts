/**
 * 权限模式的**值域契约**（`PERMISSION_MODES` / `PermissionMode` 类型与 const 对象）
 *
 * 2026-11-01（B7 解环）：自 `permission/PermissionMode.ts` **下沉至叶子模块**。
 * 迁因：`security/CompleteSecuritySystem.ts`（类型）与 `security/SecurityIntegration.ts`
 * （运行时常量）都需要它，而 `permission` 又反向依赖 `security` ⇒ `security ↔ permission`
 * 是 infra 内最后的两元环。值域本身零行为、零依赖，属于共享契约；
 * `permission/PermissionMode.ts` 保留**同名转出**（含中文名/符号映射与描述函数）。
 *
 * 2026-11-11（值域收缩 9 → 5）：原先 9 档里有两组在运行时完全同义 ——
 * - `ask` / `alwaysAsk` 与 `plan` 同支（都只返回 ask）⇒ 合并进 `plan`（每步确认）；
 * - `acceptEdits` / `strict` 在聊天主链路**没有分支**（落 `default`）⇒ 合并进 `default`。
 * 保留 `default` / `plan` / `dontAsk` / `auto` / `bypass` 五个行为真正不同的档。
 * 旧数据/旧配置里的四个值经 {@link normalizePermissionMode} **读取时归一**，不会失控。
 */

export const PERMISSION_MODES = [
  'default',
  'plan',
  'dontAsk',
  'auto',
  'bypass',
] as const;

/** 权限模式字符串联合类型 */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** 权限模式 const 对象（枚举式访问） */
export const PermissionMode = {
  DEFAULT: 'default',
  PLAN: 'plan',
  DONT_ASK: 'dontAsk',
  AUTO: 'auto',
  BYPASS: 'bypass',
} as const satisfies Record<string, PermissionMode>;

/**
 * 收缩前的档位 ⇒ 现行档位（**只用于读取旧数据 / 旧环境变量**）。
 *
 * 键为小写（与 `normalizePermissionMode` 的大小写不敏感口径一致）。
 */
export const LEGACY_PERMISSION_MODE_ALIASES: Readonly<
  Record<string, PermissionMode>
> = {
  ask: 'plan',
  alwaysask: 'plan',
  acceptedits: 'default',
  strict: 'default',
};

/**
 * 归一任意输入到 5 档（数字/对象等非字符串 ⇒ `undefined`，**不猜**）。
 *
 * - 大小写不敏感（`.env` 里写 `DEFAULT` / `PLAN` 都认）；
 * - 收缩前被合并的四个值按 {@link LEGACY_PERMISSION_MODE_ALIASES} 归一；
 * - 其余未知值 ⇒ `undefined`（调用方决定回退策略：env 回退 default、会话回退进程默认档）。
 */
export function normalizePermissionMode(
  raw: unknown
): PermissionMode | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toLowerCase();
  if (key === '') return undefined;
  const direct = PERMISSION_MODES.find((mode) => mode.toLowerCase() === key);
  if (direct) return direct;
  return LEGACY_PERMISSION_MODE_ALIASES[key];
}
