/**
 * Feature Slice — 功能模块动态注册表
 *
 * 管理所有功能模块的注册、启用/禁用、固定排序。
 * 新模块通过 registerModule() 注册，无需修改类型定义或 ViewRouter。
 */

import type { StateCreator } from "zustand";
import type { FeatureModule } from "./types";
import type { RootState } from "./index";
import { createLogger } from "@/utils/logger";

const logger = createLogger("root-store:featureSlice");

// ─── 版本分层（tier）占位 ─────────────────────────────

export type Tier = "base" | "pro";

/**
 * 当前版本（license 就绪前的占位来源）。
 * 优先级：环境变量 VITE_TIER → localStorage liri_tier → base。
 * license 体系恢复后由 licenseStore 驱动。
 */
export function getCurrentTier(): Tier {
  const envTier = import.meta.env.VITE_TIER as string | undefined;
  if (envTier === "pro" || envTier === "base") return envTier;
  try {
    const stored = localStorage.getItem("liri-tier");
    if (stored === "pro" || stored === "base") return stored;
  } catch {
    /* localStorage 不可用时默认 base */
  }
  return "base";
}

// ─── 内置模块 ──────────────────────────────────────────

const BUILTIN_MODULES: FeatureModule[] = [
  {
    id: "chat",
    type: "chat",
    name: "对话",
    icon: "message-circle",
    enabled: true,
    available: true,
    pinned: true,
    tier: "base",
  },
  {
    id: "media",
    type: "media",
    name: "媒体",
    icon: "image",
    enabled: true,
    available: true,
    pinned: false,
    tier: "base",
  },
  {
    id: "office",
    type: "office",
    name: "办公",
    icon: "file-text",
    enabled: true,
    available: true,
    pinned: false,
    tier: "pro",
  },
  {
    id: "calendar",
    type: "calendar",
    name: "日历",
    icon: "calendar",
    enabled: true,
    available: true,
    pinned: false,
    tier: "pro",
  },
  {
    id: "translation",
    type: "translation",
    name: "翻译",
    icon: "languages",
    enabled: true,
    available: true,
    pinned: false,
    tier: "base",
  },
  {
    id: "knowledge",
    type: "knowledge",
    name: "知识库",
    icon: "book-open",
    enabled: true,
    available: true,
    pinned: false,
    tier: "base",
  },
  // 阶段一 4.2.2（2026-09-04）：project 模块实体（meta/label 归一；无独立导航消费）
  {
    id: "project",
    type: "project",
    name: "项目",
    icon: "folder",
    enabled: true,
    available: true,
    pinned: false,
    tier: "base",
  },
];

// ─── Slice 接口 ────────────────────────────────────────

export interface FeatureSlice {
  /** 已注册的功能模块列表 */
  modules: FeatureModule[];

  /** 快速访问的固定模块 ID */
  pinnedModuleIds: string[];

  // ─── 注册与查询 ───

  registerModule: (module: FeatureModule) => void;
  unregisterModule: (id: string) => void;
  getModule: (id: string) => FeatureModule | undefined;

  /** 按当前版本（tier）过滤后对用户可见的模块（一处过滤入口） */
  getVisibleModules: () => FeatureModule[];

  // ─── 用户操作 ───

  toggleModule: (id: string) => void;
  pinModule: (id: string) => void;
  unpinModule: (id: string) => void;
  reorderPinned: (fromIndex: number, toIndex: number) => void;

  /** 注册模块需要跨 worktree 持久化的 UI 状态字段 */
  registerPersistentState: (moduleId: string, keys: string[]) => void;

  /** 检查后端能力就绪状态 */
  refreshAvailability: () => Promise<void>;
}

// ─── Slice 实现 ────────────────────────────────────────

export const createFeatureSlice: StateCreator<
  RootState,
  [],
  [],
  FeatureSlice
> = (set, get) => ({
  modules: [...BUILTIN_MODULES],
  pinnedModuleIds: BUILTIN_MODULES.filter((m) => m.pinned).map((m) => m.id),

  // ─── 注册/注销 ───
  registerModule: (module) => {
    const existing = get().modules.findIndex((m) => m.id === module.id);
    if (existing >= 0) {
      // 更新已注册模块（如补全 component）
      set((state) => ({
        modules: state.modules.map((m, i) =>
          i === existing ? { ...m, ...module } : m,
        ),
      }));
      logger.debug("模块更新", { moduleId: module.id });
      return;
    }
    set((state) => ({ modules: [...state.modules, module] }));
    logger.info("模块注册", { moduleId: module.id, type: module.type });
  },

  unregisterModule: (id) => {
    set((state) => ({
      modules: state.modules.filter((m) => m.id !== id),
      pinnedModuleIds: state.pinnedModuleIds.filter((pid) => pid !== id),
    }));
  },

  getModule: (id) => get().modules.find((m) => m.id === id),

  // 一处过滤：base 版隐藏 pro 模块；license 就绪后由 tier 来源驱动
  getVisibleModules: () => {
    const tier = getCurrentTier();
    return get().modules.filter(
      (m) => (m.tier ?? "base") === "base" || tier === "pro",
    );
  },

  // ─── 开关 ───
  toggleModule: (id) => {
    set((state) => ({
      modules: state.modules.map((m) =>
        m.id === id ? { ...m, enabled: !m.enabled } : m,
      ),
    }));
  },

  pinModule: (id) => {
    set((state) => ({
      modules: state.modules.map((m) =>
        m.id === id ? { ...m, pinned: true } : m,
      ),
      pinnedModuleIds: [...new Set([id, ...state.pinnedModuleIds])],
    }));
  },

  unpinModule: (id) => {
    set((state) => ({
      modules: state.modules.map((m) =>
        m.id === id ? { ...m, pinned: false } : m,
      ),
      pinnedModuleIds: state.pinnedModuleIds.filter((pid) => pid !== id),
    }));
  },

  reorderPinned: (fromIndex, toIndex) => {
    set((state) => {
      const ids = [...state.pinnedModuleIds];
      const [moved] = ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, moved);
      return { pinnedModuleIds: ids };
    });
  },

  // ─── UI 状态持久化注册 ───
  registerPersistentState: (_moduleId, _keys) => {
    // 注册的 keys 供 WorkspaceLayout.uiSnapshots 读写
    // 实际存储逻辑在 workspaceSlice.updateWorkspaceLayout 中
    logger.debug("UI 状态注册", { moduleId: _moduleId, keys: _keys });
  },

  // ─── 可用性检查 ───
  refreshAvailability: async () => {
    // 后续对接后端能力检查 API
    logger.debug("模块可用性刷新");
  },
});
