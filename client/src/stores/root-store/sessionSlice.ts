/**
 * Session Slice — 统一会话管理（SessionHub）
 *
 * 所有功能模块（chat/media/office/calendar/translation/knowledge）的交互记录
 * 统一存储，按 worktree 隔离。
 *
 * 与现有 sessionStore 并行运行（两套 Store 共存策略）。
 */

import type { StateCreator } from "zustand";
import type { SessionRecord, SessionContext } from "./types";
import type { RootState } from "./index";
import { createLogger } from "@/utils/logger";

const logger = createLogger("root-store:sessionSlice");

// ─── Slice 接口 ────────────────────────────────────────

export interface SessionSlice {
  /** 所有会话记录（Record 保证 O(1) 按 ID 查找，JSON 持久化兼容） */
  sessions: Record<string, SessionRecord>;

  /** 当前活跃会话 ID */
  currentSessionId: string | null;

  /** 用户自定义的模块排序（模块 type 数组） */
  moduleOrder: string[];

  /** 固定的会话 ID 列表 */
  pinnedSessionIds: string[];

  /** 加载/操作错误 */
  error: string | null;

  /** 是否正在加载 */
  isLoading: boolean;

  // ─── 动作 ───

  createSession: (moduleType: string, title?: string, id?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (id: string, title: string) => void;
  updateSessionContext: (id: string, updates: Partial<SessionContext>) => void;
  /** 获取或创建当前 worktree 下指定类型的 session（不存在则自动创建） */
  getOrCreateSession: (moduleType: string, title?: string) => string;
  getSessionsByWorktree: (worktreeId: string) => SessionRecord[];
  getSessionsByModule: (moduleType: string) => SessionRecord[];
  togglePin: (id: string) => void;
  isPinned: (id: string) => boolean;
}

// ─── Slice 实现 ────────────────────────────────────────

export const createSessionSlice: StateCreator<RootState, [], [], SessionSlice> = (
  set,
  get
) => ({
  sessions: {},
  currentSessionId: null,
  moduleOrder: ["chat", "media", "office", "calendar", "translation", "knowledge"],
  pinnedSessionIds: [],
  error: null,
  isLoading: false,

  // ─── 创建会话 ───
  createSession: (moduleType, title, overrideId) => {
    const wtId = get().currentWorktreeId;
    const id = overrideId ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    // 根据模块类型创建初始上下文
    let context: SessionContext;
    switch (moduleType) {
      case "media":
        context = { moduleType: "media", prompt: "" };
        break;
      case "office":
        context = { moduleType: "office", fileRef: "" };
        break;
      case "calendar":
        context = { moduleType: "calendar" };
        break;
      case "translation":
        context = { moduleType: "translation", sourceLang: "", targetLang: "" };
        break;
      case "knowledge":
        context = { moduleType: "knowledge" };
        break;
      default:
        context = { moduleType: "chat" };
    }

    const session: SessionRecord = {
      id,
      moduleType,
      worktreeId: wtId ?? "",
      title: title ?? `新${getNameByModuleType(moduleType)}`,
      createdAt: now,
      updatedAt: now,
      context,
    };

    set((state) => ({
      sessions: { ...state.sessions, [id]: session },
      // 使用 overrideId 时（如从旧 store 同步），不自动切换
      currentSessionId: overrideId ? state.currentSessionId : id,
    }));

    logger.info("会话创建", { sessionId: id, moduleType, worktreeId: wtId });
    return id;
  },

  // ─── 切换会话 ───
  switchSession: (sessionId) => {
    if (!get().sessions[sessionId]) {
      logger.warn("切换会话失败：会话不存在", { sessionId });
      return;
    }

    set({ currentSessionId: sessionId });
    logger.info("会话切换", { sessionId });
  },

  // ─── 删除会话 ───
  deleteSession: (sessionId) => {
    const { [sessionId]: _removed, ...rest } = get().sessions;

    set((state) => ({
      sessions: rest,
      currentSessionId:
        state.currentSessionId === sessionId ? null : state.currentSessionId,
      pinnedSessionIds: state.pinnedSessionIds.filter((id) => id !== sessionId),
    }));

    logger.info("会话删除", { sessionId });
  },

  // ─── 重命名 ───
  renameSession: (id, title) => {
    set((state) => {
      const sess = state.sessions[id];
      if (!sess) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: { ...sess, title, updatedAt: Date.now() },
        },
      };
    });
  },

  // ─── 更新上下文 ───
  updateSessionContext: (id, updates) => {
    set((state) => {
      const sess = state.sessions[id];
      if (!sess) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...sess,
            context: { ...sess.context, ...updates } as SessionContext,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  // ─── 获取或创建 ───
  getOrCreateSession: (moduleType, title) => {
    const wtId = get().currentWorktreeId;
    // 查找当前 worktree 下同类型的首个 session
    const existing = Object.values(get().sessions).find(
      (s) => s.worktreeId === wtId && s.moduleType === moduleType
    );
    if (existing) {
      set({ currentSessionId: existing.id });
      return existing.id;
    }
    // 不存在则创建
    return get().createSession(moduleType, title);
  },

  // ─── 查询 ───
  getSessionsByWorktree: (worktreeId) =>
    Object.values(get().sessions).filter((s) => s.worktreeId === worktreeId),

  getSessionsByModule: (moduleType) =>
    Object.values(get().sessions).filter((s) => s.moduleType === moduleType),

  // ─── 固定 ───
  togglePin: (id) => {
    const pinned = get().pinnedSessionIds;
    const updated = pinned.includes(id)
      ? pinned.filter((pid) => pid !== id)
      : [id, ...pinned];
    set({ pinnedSessionIds: updated });
  },

  isPinned: (id) => get().pinnedSessionIds.includes(id),
});

// ─── 辅助 ──────────────────────────────────────────────

/** 模块类型 → 中文名映射 */
function getNameByModuleType(type: string): string {
  const map: Record<string, string> = {
    chat: "对话",
    media: "媒体",
    office: "办公",
    calendar: "日历",
    translation: "翻译",
    knowledge: "知识库",
  };
  return map[type] ?? type;
}
