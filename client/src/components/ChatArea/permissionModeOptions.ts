/**
 * 会话级权限模式的**展示常量**（P1 第三层，2026-11-04；2026-11-11 收缩为 5 档）
 *
 * 独立成模块（而非放在组件文件里）的原因：组件文件只应导出组件
 * （`react-refresh/only-export-components`），而本表同时被单测引用做契约校验。
 *
 * ⚠️ 取值域真源在**后端** `@openliri/infra/common` 的 `PERMISSION_MODES`（前端不跨包引用）。
 * 漂移的兜底是**显式报错**：后端对未知 `permission_mode` 返回 400，不会静默降级。
 *
 * 2026-11-11（值域 9→5）：原先 9 档里有两组在运行时完全同义，已随后端一起合并 ——
 * `ask` / `alwaysAsk` ⇒ `plan`（每步确认），`acceptEdits` / `strict` ⇒ `default`。
 * 旧数据由后端读取时归一，前端不再出现这四个值。
 */
import type { SessionPermissionMode } from "@/types";

/** 5 档顺序与后端 `PERMISSION_MODES` 同集合 */
export const PERMISSION_MODE_KEYS: readonly SessionPermissionMode[] = [
  "default",
  "auto",
  "plan",
  "dontAsk",
  "bypass",
];

// 图标：见 `permissionModeIcons.tsx`（2026-11-05 起由 emoji/符号改为单色线性图标）
