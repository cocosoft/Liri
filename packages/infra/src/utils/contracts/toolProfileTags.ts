// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话级工具 profile 的**能力标签契约**（2026-11-24，R00-003 下沉）
 *
 * 原 `app/src/tools/toolProfile.ts` 用「映射表键集 + `hasOwnProperty`」做边界校验，
 * 但校验点是 service 层的 HTTP handler（`PATCH /v1/sessions/{id}/meta` 的 `tool_profile`），
 * 静态 import app 会倒挂 ⇒ 只能 `await import('@modules/tools')`（R00-003 盲区）。
 *
 * 现把**标签取值**下沉为跨层契约（唯一事实源 = 本文件的 `TOOL_PROFILE_TAGS`）；
 * app 侧的「标签 → 工具类别」映射以 `Record<ToolProfileTag, …>` 声明 ⇒ 两侧不一致时
 * **编译期即报错**（漏键 / 多键都拦），不再依赖运行期 `hasOwnProperty` 对齐。
 *
 * ⚠️ 只登记**有真实依据**的能力标签（见 app 侧映射表的注释）；凭想象扩充即造需求。
 */
export const TOOL_PROFILE_TAGS = ['media', 'coding'] as const;

/** 会话级工具 profile 的能力标签 */
export type ToolProfileTag = (typeof TOOL_PROFILE_TAGS)[number];

/**
 * 是否为**已登记**的能力标签。
 *
 * 用显式数组 `includes`（而非对象 `hasOwnProperty`）⇒ 天然不会把 `toString` / `constructor`
 * 这类原型链名误判为已登记。
 */
export function isKnownToolProfileTag(tag: string): tag is ToolProfileTag {
  return (TOOL_PROFILE_TAGS as readonly string[]).includes(tag);
}
