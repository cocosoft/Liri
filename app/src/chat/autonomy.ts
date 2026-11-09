// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * autonomy.ts — 会话自主度契约（demand「许愿式」模式；设计见
 * `dev_docs/20261109/Liri-demand许愿式模式设计方案-20261109.md` §2 D1）。
 *
 * 事实来源：**会话 metadata.autonomy**（`PATCH /v1/sessions/:id/meta` 或随消息
 * `autonomy` 下发后由会话生命周期落库）。本模块只承担两件事：
 *
 *  ① **HTTP 边界的取值校验**：`isAutonomyMode()` —— 非法值必须 fail loud（同 `work_mode`）；
 *  ② **请求体 → 会话 metadata 的更新判定**：`resolveRequestAutonomyUpdate()`（纯函数，
 *     缺失 / 脏值不覆盖已有会话值，值相同不重复写库）。
 *
 * 语义边界：`autonomy` 只描述"有人委托时怎么执行"（是否跳过计划确认、验收前置、交付回执），
 * **不**放宽权限判定；无人值守入口（P33 `autonomy.policy`）与本字段互不替代。
 * 缺省 `undefined` === `interactive` ⇒ 既有行为逐字不变。
 */

/** 会话自主度（取值与后端会话 metadata 一致，勿改名） */
export type AutonomyMode = 'interactive' | 'demand';

/** 合法取值（校验用唯一真源） */
export const AUTONOMY_MODES: readonly AutonomyMode[] = [
  'interactive',
  'demand',
];

/** 取值校验（用于 HTTP 边界等外部输入） */
export function isAutonomyMode(value: unknown): value is AutonomyMode {
  return value === 'interactive' || value === 'demand';
}

/**
 * 请求体 `autonomy` ⇒ 会话 `metadata.autonomy` 的更新判定。
 *
 * 只有请求确实携带合法值、且与当前会话值（缺省视为 `interactive`）不同才返回新值；
 * 否则 `undefined`（不重复写库）。缺失 / 脏值**不覆盖**已有会话值。
 */
export function resolveRequestAutonomyUpdate(input: {
  requestAutonomy: unknown;
  sessionAutonomy: unknown;
}): AutonomyMode | undefined {
  if (!isAutonomyMode(input.requestAutonomy)) return undefined;
  const current = isAutonomyMode(input.sessionAutonomy)
    ? input.sessionAutonomy
    : 'interactive';
  return input.requestAutonomy === current ? undefined : input.requestAutonomy;
}

/**
 * B2（2026-11-09）：会话是否处于 demand（许愿式）模式。
 *
 * 只读 `metadata.autonomy === 'demand'`（缺省 / 脏值 ⇒ false，与"未设置 === interactive"同口径）。
 * 供编排入口（同轮升级）、会话权限缺省档、计划验收校验三处共用（唯一判定点）。
 */
export function isDemandSession(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as { autonomy?: unknown }).autonomy === 'demand';
}
