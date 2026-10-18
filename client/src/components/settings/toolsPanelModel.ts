// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * toolsPanelModel — 工具可见性设置面板的**纯逻辑**（P3，2026-10-16 工具治理）
 *
 * 立项：`dev_docs/20261016/工具可见性治理方案-20261016.md` §3.5（每行必备 4 件）。
 * 抽出的目的：把"分组 / 三态流转 / 二次确认判据 / 原因文案映射"从 JSX 里剥出来 ⇒ 可单测
 * （与 `useSidebarCollapse.ts` 同法：**判据外移、动作留下**）。
 *
 * 三条口径约束：
 * - **原因枚举来自 `@shared/types`**（双端单一事实源）⇒ `Record<…>` 穷尽映射，新增取值即
 *   **编译失败**（强制补 zh/en 文案，而非静默漏渲染）；
 * - **分组派生自 `(覆写, effective)`**，不按工具类别手写分组表 —— 类别枚举属后端内部事实源；
 * - **不给假承诺**：`on` 对"未进生效工具面"（`conditional`）**无效** ⇒ 该行仍归入"不可见"组
 *   （而不是谎报为"已开启"）。
 */

import type {
  SharedToolVisibilityEntry,
  SharedToolVisibilityReason,
} from "@shared/types";
import type {
  ToolVisibilityOverrideValue,
  ToolVisibilityOverrides,
} from "../../services/toolService";

/** 原因 → i18n key（`Record` ⇒ 枚举新增取值时编译失败） */
export const TOOL_VISIBILITY_REASON_KEYS: Record<
  SharedToolVisibilityReason,
  string
> = {
  mandatory: "settings.toolsReasonMandatory",
  archived: "settings.toolsReasonArchived",
  "unregistered-category": "settings.toolsReasonUnregisteredCategory",
  "not-in-task-whitelist": "settings.toolsReasonNotInTaskWhitelist",
  conditional: "settings.toolsReasonConditional",
  "user-off": "settings.toolsReasonUserOff",
  "user-on-bypass": "settings.toolsReasonUserOnBypass",
};

/** 徽标色调（仅样式，不含文案） */
export type ToolReasonTone = "ok" | "neutral" | "warn" | "danger";

export const TOOL_VISIBILITY_REASON_TONES: Record<
  SharedToolVisibilityReason,
  ToolReasonTone
> = {
  mandatory: "ok",
  archived: "neutral",
  "unregistered-category": "danger",
  "not-in-task-whitelist": "neutral",
  conditional: "warn",
  "user-off": "danger",
  "user-on-bypass": "ok",
};

/** 徽标优先级（I-4：每行只显示**一个主因**；`conditional` 最根本 —— 没接线比类别不在白名单更前置） */
const PRIMARY_REASON_PRIORITY: readonly SharedToolVisibilityReason[] = [
  "conditional",
  "archived",
  "unregistered-category",
  "not-in-task-whitelist",
  "user-off",
  "user-on-bypass",
  "mandatory",
];

/**
 * 取该行的**主因**（无原因 ⇒ `null`）。
 *
 * 后端 `reasons` 保持完整（供诊断/搜索），渲染层只显示主因，避免一行挂多个徽标互相稀释。
 */
export function primaryReasonOf(
  entry: SharedToolVisibilityEntry,
): SharedToolVisibilityReason | null {
  for (const reason of PRIMARY_REASON_PRIORITY) {
    if (entry.reasons.includes(reason)) return reason;
  }
  return null;
}

/** 状态分组（`on` = 用户强制开启且**确实生效**） */
export type ToolVisibilityGroupId = "on" | "default" | "off" | "hidden";

/**
 * 分组判据（**派生**；顺序即优先级）。
 *
 * ⚠️ `overrides[name] === 'on'` 但 `effective === 'hidden'`（未进生效工具面）⇒ 归 `hidden`：
 * 面板必须如实显示"开了但本构建不支持"，不得显示为已开启（方案 §8 边界 ②）。
 */
export function groupOf(
  entry: SharedToolVisibilityEntry,
  overrides: ToolVisibilityOverrides,
): ToolVisibilityGroupId {
  const value = overrideValueOf(overrides, entry.name);
  if (value === "on") return entry.effective === "visible" ? "on" : "hidden";
  if (value === "off") return "off";
  return entry.effective === "visible" ? "default" : "hidden";
}

/** 取某工具的覆写值（缺省 = `auto`） */
export function overrideValueOf(
  overrides: ToolVisibilityOverrides,
  name: string,
): ToolVisibilityOverrideValue {
  const value = overrides[name];
  return value === "on" || value === "off" ? value : "auto";
}

/**
 * 生成**新**覆写表（不可变；`auto` ⇒ **删除该键**，与后端"只含 on/off"的归一化口径一致）。
 */
export function withOverride(
  overrides: ToolVisibilityOverrides,
  name: string,
  value: ToolVisibilityOverrideValue,
): ToolVisibilityOverrides {
  const next: ToolVisibilityOverrides = { ...overrides };
  if (value === "auto") delete next[name];
  else next[name] = value;
  return next;
}

/**
 * 是否需要**二次确认**：把**高风险**工具**新开为可见**时要求确认。
 *
 * 文案必须含"可见不代表放行，写操作仍需审批"（方案 §3.5 第 3 件 / 风险 R1）——
 * 本层只改可见性，**永不**触碰审批与 PathGuard。
 */
export function requiresRiskConfirm(
  entry: SharedToolVisibilityEntry,
  next: ToolVisibilityOverrideValue,
): boolean {
  return next === "on" && entry.risk === "high";
}

/** 搜索过滤（名字 / 类别 / 原因词 命中即保留；大小写不敏感） */
export function filterEntries(
  entries: readonly SharedToolVisibilityEntry[],
  query: string,
): SharedToolVisibilityEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      e.reasons.some((r) => r.includes(q)),
  );
}

/** 分组统计（供分组标题与总览使用） */
export interface ToolsPanelSummary {
  total: number;
  /** 最终对模型可见（含 `on` 生效者） */
  visible: number;
  /** 用户强制开启且生效 */
  forcedOn: number;
  /** 用户强制关闭 */
  forcedOff: number;
  /** 未进生效工具面（覆写也无效） */
  conditional: number;
}

export function summarize(
  entries: readonly SharedToolVisibilityEntry[],
  overrides: ToolVisibilityOverrides,
): ToolsPanelSummary {
  let visible = 0;
  let forcedOn = 0;
  let forcedOff = 0;
  let conditional = 0;
  for (const e of entries) {
    if (e.effective === "visible") visible++;
    const group = groupOf(e, overrides);
    if (group === "on") forcedOn++;
    if (group === "off") forcedOff++;
    if (e.registration === "conditional") conditional++;
  }
  return { total: entries.length, visible, forcedOn, forcedOff, conditional };
}
