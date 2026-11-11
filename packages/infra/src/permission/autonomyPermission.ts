/**
 * 「许愿式（demand）× 权限档」一致性契约（2026-11-11）
 *
 * 为什么需要：`autonomy` 与 `permission_mode` 是两个独立 metadata 字段，但语义上
 * **许愿式承诺"中途最多问一次"**，而「每步确认」档（`plan`）要求**每次工具调用都询问**
 * —— 任意入口把它们写成这组组合，承诺当场失效（用户看到"许愿式"，实际每一步都在弹审批）。
 * 前端已把两者收敛成一个三档控件；本模块把同一不变量落到**写入口**，防止脚本 /
 * 老客户端 / 后续新入口再造出自相矛盾的会话。
 *
 * 判定口径（**只拒绝会产生"逐次询问"的档**）：
 * - 互斥：`plan`（2026-11-11 收缩前的 `ask` / `alwaysAsk` 已并入此档）——与"最多问一次"
 *   不可能同时成立；
 * - 允许：`dontAsk`（直接拒绝，**不产生询问**）、`bypass`（全放行）、
 *   `auto` / `default`（缺省档）—— 与 D3「显式档可收紧 / 可放宽」一致；
 * - `null` = 清除会话覆盖、回退进程默认档 ⇒ 不构成冲突。
 *
 * 纯函数、零依赖（仅抛 `AppError`）：HTTP 边界与 `updateSessionMeta` 写入口共用一份。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/kernel';
import { normalizePermissionMode } from '../common/permissionMode';

/** 冲突错误的稳定 code（HTTP 400 响应体与日志共用，禁止各处另写字符串） */
export const AUTONOMY_PERMISSION_CONFLICT = 'AUTONOMY_PERMISSION_CONFLICT';

/**
 * demand 下会"逐次审批"的权限档。
 *
 * 收缩前的 `ask` / `alwaysAsk` 已并入 `plan`；判定时先经 `normalizePermissionMode`
 * 归一，因此旧会话里的这两个值同样会被拦下。
 */
export const DEMAND_PROMPT_HEAVY_PERMISSION_MODES = ['plan'] as const;

export interface AutonomyPermissionInput {
  /** 写入前的会话值（缺省 / 脏值 ⇒ interactive） */
  currentAutonomy?: unknown;
  /** 写入前的会话值（`metadata.permission_mode`；缺省 ⇒ 跟随进程默认档） */
  currentPermissionMode?: unknown;
  /** 本次请求的自主度（`undefined` = 不改动） */
  nextAutonomy?: unknown;
  /** 本次请求的权限档（`undefined` = 不改动；`null` = 清除会话覆盖） */
  nextPermissionMode?: unknown;
}

export interface EffectiveAutonomyPermission {
  autonomy: 'interactive' | 'demand';
  /** 生效的权限档；`undefined` = 无会话覆盖（跟随进程默认档） */
  permissionMode?: string;
}

/**
 * 计算写入后的**生效组合**（请求值优先，缺省继承会话现值）。
 *
 * 取不出合法值时一律回退既有语义：autonomy 缺省 === interactive；permission_mode
 * 缺省 === 跟随进程默认档（`undefined`）。
 */
export function resolveEffectiveAutonomyPermission(
  input: AutonomyPermissionInput
): EffectiveAutonomyPermission {
  const nextAutonomy =
    input.nextAutonomy === 'demand' || input.nextAutonomy === 'interactive'
      ? input.nextAutonomy
      : undefined;
  const autonomy =
    nextAutonomy ??
    (input.currentAutonomy === 'demand' ? 'demand' : 'interactive');

  const permissionMode =
    input.nextPermissionMode === null
      ? undefined
      : typeof input.nextPermissionMode === 'string'
        ? input.nextPermissionMode
        : typeof input.currentPermissionMode === 'string'
          ? input.currentPermissionMode
          : undefined;

  return { autonomy, permissionMode };
}

/** 生效组合是否为「许愿式 × 逐次询问档」的互斥组合（旧值先归一，再判定） */
export function isDemandPermissionConflict(
  effective: EffectiveAutonomyPermission
): boolean {
  if (effective.autonomy !== 'demand') return false;
  const mode = normalizePermissionMode(effective.permissionMode);
  return (
    mode !== undefined &&
    (DEMAND_PROMPT_HEAVY_PERMISSION_MODES as readonly string[]).includes(mode)
  );
}

/**
 * 冲突错误文案（HTTP 400 的 `error.message` 与日志共用）。
 *
 * 必须同时给出两个值 + **可执行的修复方式**：调用方（脚本 / 老客户端）看到的
 * 只有这一句话，不能让它去猜。
 */
export function buildAutonomyPermissionConflictMessage(
  effective: EffectiveAutonomyPermission
): string {
  return (
    `autonomy="demand" 与 permission_mode="${effective.permissionMode}" 冲突：` +
    `许愿式承诺"中途最多问一次"，而该权限档要求每次工具调用都询问。` +
    `请在**同一次请求**里把 permission_mode 设为 "auto"（或 "default"/"bypass"，或 null 清除覆盖），` +
    `或把 autonomy 设为 "interactive"。`
  );
}

/**
 * 消息级判定的纯函数形态（`POST /v1/chat/completions` 的 `autonomy` 字段）。
 *
 * 与写入口的 `assertCoherentAutonomyPermission` 同一契约，但口径更窄：
 * **只有"请求值确实改变会话值、且改后的组合互斥"才算冲突**。
 * 值未变 ⇒ `null`（`_applyRequestAutonomy` 本就不会写库 ⇒ 历史脏组合不该把会话锁死）。
 *
 * @returns 冲突文案；无冲突 / 非法 autonomy（由调用方另行 400）⇒ `null`
 */
export function resolveMessageAutonomyConflict(input: {
  currentAutonomy?: unknown;
  currentPermissionMode?: unknown;
  nextAutonomy?: unknown;
}): string | null {
  const next = input.nextAutonomy;
  if (next !== 'interactive' && next !== 'demand') return null;
  const current = input.currentAutonomy === 'demand' ? 'demand' : 'interactive';
  if (current === next) return null;
  const effective = resolveEffectiveAutonomyPermission({
    currentAutonomy: current,
    currentPermissionMode: input.currentPermissionMode,
    nextAutonomy: next,
  });
  return isDemandPermissionConflict(effective)
    ? buildAutonomyPermissionConflictMessage(effective)
    : null;
}

/**
 * 校验写入后的组合是否自洽；不自洽 **fail loud**（`AppError` + 稳定 code）。
 *
 * 调用方应在**任何写入（内存 / 落盘）之前**调用 —— 校验失败不得留下半写状态。
 */
export function assertCoherentAutonomyPermission(
  input: AutonomyPermissionInput
): void {
  const effective = resolveEffectiveAutonomyPermission(input);
  if (!isDemandPermissionConflict(effective)) return;

  throw new AppError(
    buildAutonomyPermissionConflictMessage(effective),
    ErrorCategory.VALIDATION,
    ErrorSeverity.MEDIUM,
    AUTONOMY_PERMISSION_CONFLICT,
    {
      autonomy: effective.autonomy,
      permissionMode: effective.permissionMode,
    }
  );
}
