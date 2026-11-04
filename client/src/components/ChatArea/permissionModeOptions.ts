/**
 * 会话级权限模式的**展示常量**（P1 第三层，2026-11-04）
 *
 * 独立成模块（而非放在组件文件里）的原因：组件文件只应导出组件
 * （`react-refresh/only-export-components`），而本表同时被单测引用做契约校验。
 *
 * ⚠️ 取值域真源在**后端** `@openliri/infra/common` 的 `PERMISSION_MODES`（前端不跨包引用）。
 * 漂移的兜底是**显式报错**：后端对未知 `permission_mode` 返回 400，不会静默降级。
 */
import type { SessionPermissionMode } from "@/types";

/** 9 档顺序与后端 `PERMISSION_MODES` 同集合 */
export const PERMISSION_MODE_KEYS: readonly SessionPermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "ask",
  "alwaysAsk",
  "dontAsk",
  "strict",
  "bypass",
];

/** 与后端 `PERMISSION_MODE_SYMBOLS` 对齐（`default` 后端为空串，这里用齿轮便于识别） */
export const PERMISSION_MODE_SYMBOLS: Record<SessionPermissionMode, string> = {
  default: "⚙",
  acceptEdits: "✎",
  plan: "⏸",
  bypass: "⚡",
  dontAsk: "🔇",
  auto: "🔄",
  ask: "❓",
  alwaysAsk: "⚠️",
  strict: "🔒",
};
