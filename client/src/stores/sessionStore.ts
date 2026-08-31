/**
 * Session Store — rootStore 的薄封装（零重复状态）
 *
 * 所有状态真实存储在 useRootStore.sessionSlice 中。
 * useSessionStore 是一个 Zustand store 镜像，通过 subscribe 自动同步 rootStore 变更。
 * 组件使用方式和 API 完全不变。
 *
 * 迁移完成后，组件可逐步迁移到 useRootStore 直接取值。
 */

import { create } from "zustand";
import { Session } from "../types";
import { useRootStore } from "./root-store";

interface SessionStore {
  sessions: Session[];
  currentSession: Session | null;
  isLoading: boolean;
  switching: boolean;
  error: string | null;
  loadSessions: () => Promise<void>;
  createSession: (title: string) => Promise<Session>;
  switchSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  clearAllSessions: () => Promise<void>;
  /** M1-T1.3：置顶/取消置顶（持久化到后端 metadata.pinned） */
  togglePin: (id: string) => Promise<void>;
  isPinned: (id: string) => boolean;
}

/**
 * 从 rootStore 派生当前 sessionStore 镜像状态
 */
function deriveState(root: ReturnType<typeof useRootStore.getState>): {
  sessions: Session[];
  currentSession: Session | null;
  isLoading: boolean;
  switching: boolean;
  error: string | null;
} {
  const currentId = root.currentSessionId;
  return {
    sessions: root.chatSessions ?? [],
    currentSession: currentId
      ? ((root.chatSessions ?? []).find((s) => s.id === currentId) ?? null)
      : null,
    isLoading: root.isLoading,
    switching: root.switching,
    error: root.error,
  };
}

/**
 * sessionStore — rootStore 的 Zustand 镜像
 *
 * 自身无独立 persist（P12 修复：移除双 persist 竞态）。
 * 所有持久化由 rootStore（liri-root-store）统一管理。
 * 首次创建时执行一次性迁移：将旧的 liri-sessions 数据迁移到 rootStore。
 */
export const useSessionStore = create<SessionStore>()(() => ({
  ...deriveState(useRootStore.getState()),

  loadSessions: () => useRootStore.getState().loadChatSessions(),
  createSession: (title) => useRootStore.getState().createChatSession(title),
  switchSession: (id) => useRootStore.getState().switchChatSession(id),
  deleteSession: (id) => useRootStore.getState().deleteChatSession(id),
  renameSession: (id, title) =>
    useRootStore.getState().renameChatSession(id, title),
  clearAllSessions: () => useRootStore.getState().clearAllChatSessions(),
  togglePin: (id) => useRootStore.getState().togglePin(id),
  isPinned: (id) => useRootStore.getState().isPinned(id),
}));

// P12: 一次性迁移 — 将旧的 liri-sessions localStorage 数据迁移到 rootStore
// NOTE: 迁移代码自清洁（完成后删除 key），无副作用。可在全面迁移确认后移除。
// L5-fix: 迁移执行时机对齐 persist hydration —— 原实现顶层同步执行，若 storage
// 换异步实现（IndexedDB 等），迁移结果可能被 hydrate 覆盖。现改为：
// 已 hydrate → 立即执行；未 hydrate → 挂 onFinishHydration 后执行。
function applyLegacySessionsMigration(): void {
  try {
    const oldData = localStorage.getItem("liri-sessions");
    if (!oldData) return;
    const parsed = JSON.parse(oldData);
    const root = useRootStore.getState();
    const state = parsed?.state;
    if (state?.sessions?.length && root.chatSessions.length === 0) {
      useRootStore.setState((s) => ({
        ...s,
        chatSessions: state.sessions as Session[],
      }));
    }
    if (state?.currentSession?.id) {
      useRootStore.setState((s) => ({
        ...s,
        currentSessionId: state.currentSession.id,
      }));
    }
    // 迁移完成后清除旧 key，防止重复迁移
    localStorage.removeItem("liri-sessions");
  } catch {
    // 迁移失败不影响正常使用
    localStorage.removeItem("liri-sessions");
  }
}

if (useRootStore.persist?.hasHydrated?.()) {
  applyLegacySessionsMigration();
} else {
  useRootStore.persist?.onFinishHydration?.(applyLegacySessionsMigration);
}

// ─── 核心：rootStore → sessionStore 单向镜像 ────────────
// rootStore 是唯一事实来源，sessionStore 只是它的投影。
// 任何 rootStore 变更自动同步到 sessionStore，保证「数出同源」。

useRootStore.subscribe((root) => {
  useSessionStore.setState(deriveState(root));
});

// 状态变更日志（仅开发环境）
import { withStoreLogging } from "../utils/storeLogger";
withStoreLogging(useSessionStore, "sessionStore", [
  "switching",
  "isLoading",
  "sessions",
]);
