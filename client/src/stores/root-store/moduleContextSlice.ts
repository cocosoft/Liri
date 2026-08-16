/**
 * ModuleContext Slice
 *
 * 统一管理当前模块上下文，替代 currentWorkspaceId 承担"模块路由"职责。
 * currentWorkspaceId 降级为内部兼容字段，仅保留工作空间联动功能。
 *
 * enterModule 为唯一入口，switchWorkspace 不再对外暴露。
 */

import type { StateCreator } from "zustand";

// ─── ModuleType（与 moduleRegistry 对齐，single source of truth）───

export type ModuleType =
  | "chat"
  | "project"
  | "media"
  | "office"
  | "calendar"
  | "translation"
  | "knowledge"
  | "system";

// ─── ModuleContext ──────────────────────────────────────

export interface ModuleContext {
  moduleType: ModuleType;
  projectId?: string;
  projectName?: string;
  sessionId?: string;
  /** 设置时间戳（用于 loadToken 竞态校验） */
  updatedAt: number;
}

// ─── Slice State & Actions ──────────────────────────────

export interface ModuleContextState {
  moduleContext: ModuleContext;
  /** rehydrate 完成后 + enterModule 调用后为 true，侧栏仅在 ready 时渲染 */
  _contextReady: boolean;
  /** 竞态保护：发起加载时的时间戳，API 返回后校验是否过期 */
  _loadToken: number;
}

export interface ModuleContextActions {
  enterModule: (ctx: Omit<ModuleContext, "updatedAt">) => void;
  leaveModule: () => void;
  setSessionId: (sessionId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────

/** 从 workspaceId 推断 moduleType（仅用于迁移兜底 + Hub 缺失时的侧栏过滤） */
export function inferModuleTypeFromWorkspaceId(wtId: string): ModuleType {
  if (wtId === "chat" || !wtId) return "chat";
  if (wtId.startsWith("project-") || wtId === "projects") return "project";
  const systemMap: Record<string, ModuleType> = {
    media: "media",
    office: "office",
    calendar: "calendar",
    translation: "translation",
    knowledge: "knowledge",
  };
  return systemMap[wtId] ?? "chat";
}

/** 判断 workspaceId 是否属于 project 类 */
export function isProjectWorkspace(wtId: string): boolean {
  return wtId.startsWith("project-") || wtId === "projects";
}

/** 统一 workspaceId 解析（显式入参，不依赖 get() 隐式读取） */
export function resolveWorkspaceId(
  moduleType: ModuleType,
  projectId?: string,
): string {
  switch (moduleType) {
    case "chat":
      return "chat";
    case "project":
      return projectId || "projects";
    default:
      return moduleType; // media→"media", office→"office" ...
  }
}

// ─── Slice Factory ───────────────────────────────────────

export const createModuleContextSlice: StateCreator<
  ModuleContextState & ModuleContextActions,
  [],
  [],
  ModuleContextState & ModuleContextActions
> = (set, get) => ({
  moduleContext: {
    moduleType: "chat",
    updatedAt: 0,
  },
  _contextReady: false,
  _loadToken: 0,

  enterModule: (ctx) => {
    const prev = get().moduleContext;

    // 幂等：同一模块 + 同项目 + 同项目名 + 同会话，不重复切换
    if (
      prev.moduleType === ctx.moduleType &&
      prev.projectId === ctx.projectId &&
      prev.projectName === ctx.projectName &&
      prev.sessionId === ctx.sessionId
    ) {
      // BUG-74 修复：幂等短路不再重置 ready 标记。StrictMode 双挂载（dev）时序为
      // mount#1 enterModule(true) → leaveModule(false) → mount#2 enterModule(幂等 return)，
      // 若此处不补标记，_contextReady 永久为 false → 侧边栏会话列表
      // `!contextReady && sessions.length === 0` 永远显示"加载中..."。
      // 刷新页面 rehydrate 重置 _contextReady=false 时同样依赖此处补标记。
      set({ _contextReady: true } as Partial<ModuleContextState>);
      return;
    }

    const loadToken = Date.now();
    set({
      moduleContext: { ...ctx, updatedAt: loadToken },
      _contextReady: true,
      _loadToken: loadToken,
      // 向后兼容：同步 currentWorkspaceId
      currentWorkspaceId: resolveWorkspaceId(ctx.moduleType, ctx.projectId),
    } as unknown as Partial<ModuleContextState>);
  },

  leaveModule: () => {
    set({ _contextReady: false } as Partial<ModuleContextState>);
  },

  setSessionId: (sessionId) => {
    const prev = get().moduleContext;
    set({
      moduleContext: { ...prev, sessionId, updatedAt: Date.now() },
    } as Partial<ModuleContextState>);
  },
});
