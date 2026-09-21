/**
 * 内置功能模块 —— **单一事实来源**（N-8 / N-9 收敛）
 *
 * 背景：此前同一批模块在两处各写一份 —— `stores/root-store/featureSlice.ts` 的
 * `BUILTIN_MODULES`（无 `paths`）与 `stores/root-store/moduleRegistry.ts` 的
 * `registerBuiltinModules()`（带 `paths`，由 `App.tsx` 调用后按 id **合并覆盖**
 * `{ ...m, ...module }`）。同一实体需两处维护，且 `paths` 的来源在 featureSlice
 * 中不可见（隐式叠加）。
 *
 * 现收敛为：本文件是唯一一份定义；`featureSlice` 以它作为初始 state；
 * `registerBuiltinModules()` 已删除（不再需要"注册 + 叠加"这一步）。
 *
 * 字段取舍（依据 Spec「字段活性」表 + Phase B 清理）：
 * - 保留（有读取点）：`id` / `type` / `tier` / `enabled` / `paths`
 * - 保留（派生用）：`pinned`（`pinnedModuleIds` 初始化）
 * - **已移除（Phase B）**：`available`（无读取点）、`name` / `icon`（无消费者，N-8；
 *   其硬编码中文亦属 CS02 相邻问题）
 *
 * 依赖方向：仅 `import type` 依赖 store 的类型（运行时无环），与 `config/navRegistry.ts` 同层。
 */

import type { FeatureModule } from "@/stores/root-store/types";

export const BUILTIN_MODULES: FeatureModule[] = [
  {
    id: "chat",
    type: "chat",
    enabled: true,
    pinned: true,
    tier: "base",
    paths: ["/chat"],
  },
  {
    id: "media",
    type: "media",
    enabled: true,
    pinned: false,
    tier: "base",
    paths: ["/media", "/image", "/tts"],
  },
  {
    // 版本分层：pro 模块，base 档由 getVisibleModules() 隐藏
    id: "office",
    type: "office",
    enabled: true,
    pinned: false,
    tier: "pro",
    paths: ["/office"],
  },
  {
    // D5：日历已并入办公（canonical /office?view=calendar），无独立模块注册；
    // MODULE_EMOJI_META 保留 calendar 键（存量会话标签不退化，D-b①）
    id: "knowledge",
    type: "knowledge",
    enabled: true,
    pinned: false,
    tier: "base",
    paths: ["/knowledge", "/files"],
  },
  {
    // 阶段一 4.2.2（2026-09-04）：project 模块实体（meta/label 归一；无独立导航消费）
    id: "project",
    type: "project",
    enabled: true,
    pinned: false,
    tier: "base",
    paths: ["/projects"],
  },
];
