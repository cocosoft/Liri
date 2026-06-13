import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Session } from "../types";
import { sessionService } from "../services/sessionService";
import { useChatStore } from "./chatStore";

// 会话切换互斥锁队列 — 防止快速切换导致竞态（P0-1/P1-7）
// 使用队列机制替代简单的 300ms 超时，确保连续切换按序执行
let _switchLock = false;
let _lastSwitchId: string | null = null;
let _switchQueue: string[] = [];

interface SessionStore {
  sessions: Session[];
  currentSession: Session | null;
  isLoading: boolean;
  error: string | null;
  pinnedSessionIds: string[];
  loadSessions: () => Promise<void>;
  createSession: (title: string) => Promise<Session>;
  switchSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  clearAllSessions: () => Promise<void>;
  togglePin: (id: string) => void;
  isPinned: (id: string) => boolean;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSession: null,
      isLoading: false,
      error: null,
      pinnedSessionIds: [],

      togglePin: (id: string) => {
        const pinned = get().pinnedSessionIds;
        const updated = pinned.includes(id)
          ? pinned.filter((pid) => pid !== id)
          : [id, ...pinned];
        set({ pinnedSessionIds: updated });
      },

      isPinned: (id: string) => {
        return get().pinnedSessionIds.includes(id);
      },

      loadSessions: async () => {
        set({ isLoading: true, error: null });
        try {
          let sessions = await sessionService.list();
          sessions = sessions.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          const currentSession = await sessionService.getCurrent();
          set({ sessions, currentSession, isLoading: false });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      createSession: async (title: string) => {
        console.debug("[sessionStore] Creating session with title:", title);
        set({ isLoading: true, error: null });
        try {
          const session = await sessionService.create(title);
          console.debug("[sessionStore] Created session:", session.id, session.title);
          useChatStore.getState().clearMessages();
          let sessions = await sessionService.list();
          sessions = sessions.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          console.debug(
            "[sessionStore] Session list after create:",
            sessions.length,
            "sessions",
          );
          console.debug(
            "[sessionStore] Session IDs:",
            sessions.map((s) => s.id),
          );
          set({
            sessions,
            currentSession: session,
            isLoading: false,
          });
          return session;
        } catch (error) {
          console.error("[sessionStore] Failed to create session:", error);
          set({ error: String(error), isLoading: false });
          throw error;
        }
      },

  switchSession: async (id: string) => {
    // 互斥锁队列：正在切换中则入队等待
    if (_switchLock) {
      console.warn("[sessionStore] Switch already in progress, queuing", id);
      // 去重：同一会话已在队列中则不再重复入队
      if (!_switchQueue.includes(id)) {
        _switchQueue.push(id);
      }
      return;
    }

    _switchLock = true;
    _lastSwitchId = id;
    set({ isLoading: true, error: null });

    try {
      // 先 flush 当前会话未持久化的 blocks，避免切走时丢失
      await useChatStore.getState().flushPendingSaves();
      if (_lastSwitchId !== id) return;

      const session = await sessionService.switch(id);
      if (_lastSwitchId !== id) return;

      const messages = await sessionService.getMessages(id);
      if (_lastSwitchId !== id) return;

      useChatStore.getState().setMessages(messages);
      set({ currentSession: session, isLoading: false });
    } catch (error) {
      if (_lastSwitchId === id) {
        set({ error: String(error), isLoading: false });
      }
    } finally {
      _switchLock = false;
      // 处理队列中的下一个切换请求
      const nextId = _switchQueue.shift();
      if (nextId) {
        setTimeout(() => {
          useSessionStore.getState().switchSession(nextId);
        }, 0);
      }
    }
  },

  deleteSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await sessionService.delete(id);
      const sessions = get().sessions.filter((s) => s.id !== id);
      const currentSession =
        get().currentSession?.id === id
          ? sessions[0] || null
          : get().currentSession;
      set({ sessions, currentSession, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  renameSession: async (id: string, title: string) => {
    set({ isLoading: true, error: null });
    try {
      await sessionService.rename(id, title);
      const sessions = get().sessions.map((s) =>
        s.id === id ? { ...s, title } : s,
      );
      const current = get().currentSession;
      const updatedSession: Session | null =
        current?.id === id ? { ...current, title } : current;
      set({ sessions, currentSession: updatedSession, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  clearAllSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      await sessionService.clearAll();
      useChatStore.getState().clearMessages();
      set({ sessions: [], currentSession: null, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }},
  }),
  {
    name: "liri-sessions",
    partialize: (state) => ({
      sessions: state.sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })),
      currentSession: state.currentSession
        ? { id: state.currentSession.id, title: state.currentSession.title, updatedAt: state.currentSession.updatedAt }
        : null,
      pinnedSessionIds: state.pinnedSessionIds,
    }),
  },
));
