/**
 * Session Slice — 统一会话管理（SessionHub）+ 旧 sessionStore 状态
 *
 * 两套数据并存于 rootStore，由 sessionStore.ts 薄封装层对外暴露旧 API。
 * 所有功能模块（chat/media/office/calendar/translation/knowledge）的交互记录
 * 统一存储，按 worktree 隔离。
 */

import type { StateCreator } from "zustand";
import type { SessionRecord, SessionContext } from "./types";
import type { RootState } from "./index";
import type { Session } from "@/types";
import { createLogger } from "@/utils/logger";

const logger = createLogger("root-store:sessionSlice");

// ─── Slice 接口 ────────────────────────────────────────

export interface SessionSlice {
  // ── 新 SessionHub 字段 ──
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

  // ── 旧 sessionStore 兼容字段 ──
  /** 旧 Session[] 格式（sessionStore 镜像源，来自 sessionService.list()） */
  chatSessions: Session[];

  /** 会话切换中（UI loading 指示器） */
  switching: boolean;

  // ─── SessionHub 动作 ───
  createSession: (moduleType: string, title?: string, id?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (id: string, title: string) => void;
  updateSessionContext: (id: string, updates: Partial<SessionContext>) => void;
  getOrCreateSession: (moduleType: string, title?: string) => string;
  getSessionsByWorktree: (worktreeId: string) => SessionRecord[];
  getSessionsByModule: (moduleType: string) => SessionRecord[];
  togglePin: (id: string) => void;
  isPinned: (id: string) => boolean;

  // ─── 旧 sessionStore 兼容动作（异步，调用 sessionService）───
  /** 从后端加载会话列表 + 当前会话 */
  loadChatSessions: () => Promise<void>;
  /** 创建新会话（调用 sessionService.create，联动 chatStore） */
  createChatSession: (title: string) => Promise<Session>;
  /** 切换会话（停止流、flush、加载消息、恢复模型、联动工作空间） */
  switchChatSession: (id: string) => Promise<void>;
  /** 删除会话 */
  deleteChatSession: (id: string) => Promise<void>;
  /** 重命名会话 */
  renameChatSession: (id: string, title: string) => Promise<void>;
  /** 清空所有会话 */
  clearAllChatSessions: () => Promise<void>;
}

// ─── Slice 实现 ────────────────────────────────────────

export const createSessionSlice: StateCreator<RootState, [], [], SessionSlice> = (
  set,
  get
) => ({
  // ── 初始状态 ──
  sessions: {},
  currentSessionId: null,
  moduleOrder: ["chat", "media", "office", "calendar", "translation", "knowledge"],
  pinnedSessionIds: [],
  error: null,
  isLoading: false,
  chatSessions: [],
  switching: false,

  // ─── SessionHub 动作 ────────────────────────────────

  createSession: (moduleType, title, overrideId) => {
    const wtId = get().currentWorktreeId;
    const id = overrideId ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

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
      currentSessionId: overrideId ? state.currentSessionId : id,
    }));

    logger.info("会话创建", { sessionId: id, moduleType, worktreeId: wtId });
    return id;
  },

  switchSession: (sessionId) => {
    if (!get().sessions[sessionId]) {
      logger.warn("切换会话失败：会话不存在", { sessionId });
      return;
    }
    set({ currentSessionId: sessionId });
    logger.info("会话切换", { sessionId });
  },

  deleteSession: (sessionId) => {
    const { [sessionId]: _removed, ...rest } = get().sessions;
    set((state) => ({
      sessions: rest,
      currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      pinnedSessionIds: state.pinnedSessionIds.filter((id) => id !== sessionId),
    }));
    logger.info("会话删除", { sessionId });
  },

  renameSession: (id, title) => {
    set((state) => {
      const sess = state.sessions[id];
      if (!sess) return state;
      return {
        sessions: { ...state.sessions, [id]: { ...sess, title, updatedAt: Date.now() } },
      };
    });
  },

  updateSessionContext: (id, updates) => {
    set((state) => {
      const sess = state.sessions[id];
      if (!sess) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: { ...sess, context: { ...sess.context, ...updates } as SessionContext, updatedAt: Date.now() },
        },
      };
    });
  },

  getOrCreateSession: (moduleType, title) => {
    const wtId = get().currentWorktreeId;
    const existing = Object.values(get().sessions).find(
      (s) => s.worktreeId === wtId && s.moduleType === moduleType
    );
    if (existing) {
      set({ currentSessionId: existing.id });
      return existing.id;
    }
    return get().createSession(moduleType, title);
  },

  getSessionsByWorktree: (worktreeId) =>
    Object.values(get().sessions).filter((s) => s.worktreeId === worktreeId),

  getSessionsByModule: (moduleType) =>
    Object.values(get().sessions).filter((s) => s.moduleType === moduleType),

  togglePin: (id) => {
    const pinned = get().pinnedSessionIds;
    const updated = pinned.includes(id)
      ? pinned.filter((pid) => pid !== id)
      : [id, ...pinned];
    set({ pinnedSessionIds: updated });
  },

  isPinned: (id) => get().pinnedSessionIds.includes(id),

  // ─── 旧 sessionStore 兼容动作（异步）────────────────

  loadChatSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const { sessionService } = await import("@/services/sessionService");
      let sessions = await sessionService.list();
      sessions = sessions.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      const currentSession = await sessionService.getCurrent();
      set({
        chatSessions: sessions,
        currentSessionId: currentSession?.id ?? null,
        isLoading: false,
      });
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(error, { module: 'stores:sessionSlice', action: 'loadChatSessions' }, 'warn');
      set({ error: String(error), isLoading: false });
    }
  },

  createChatSession: async (title: string) => {
    logger.debug("创建会话:", title);
    set({ isLoading: true, error: null });
    try {
      const { sessionService } = await import("@/services/sessionService");

      // 获取当前后端生效模型
      let modelId: string | undefined;
      try {
        const { modelSwitchService } = await import("@/services/modelSwitchService");
        const current = await modelSwitchService.getCurrent();
        modelId = current.modelId;
      } catch (e) {
        const { handleClientError } = await import("@/utils/handleError");
        handleClientError(e, { module: 'stores:sessionSlice', action: 'createChatSession:getModelId' }, 'warn');
      }

      // 获取任务分工配置
      let tasksOverride: Record<string, string> | undefined;
      try {
        const { modelSwitchService } = await import("@/services/modelSwitchService");
        const tasks = await modelSwitchService.getTasks();
        tasksOverride = tasks as Record<string, string>;
      } catch (e) {
        const { handleClientError } = await import("@/utils/handleError");
        handleClientError(e, { module: 'stores:sessionSlice', action: 'createChatSession:getTasks' }, 'warn');
      }

      // 获取当前工作空间
      let workspaceId: string | undefined;
      let workspacePath: string | undefined;
      const currentWtId = get().currentWorktreeId;
      const wt = currentWtId ? get().worktrees[currentWtId] : undefined;
      if (wt) {
        workspaceId = wt.id;
        workspacePath = wt.name;
      }

      const session = await sessionService.create(title, { modelId, workspaceId, workspacePath });
      const sessionWithTasks: Session = tasksOverride
        ? { ...session, tasksOverride: tasksOverride as unknown as Partial<import("@/types/model").TaskModelConfig> }
        : session;

      logger.debug("会话已创建: " + session.id, { modelId, workspaceId });

      // 清空 chatStore 消息
      try {
        const { useChatStore } = await import("@/stores/chatStore");
        useChatStore.getState().clearMessages();
      } catch (e) {
        const { handleClientError } = await import("@/utils/handleError");
        handleClientError(e, { module: 'stores:sessionSlice', action: 'createChatSession:clearMessages' }, 'warn');
      }

      // 重新加载会话列表
      let sessions = await sessionService.list();
      sessions = sessions.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

      set({
        chatSessions: sessions,
        currentSessionId: sessionWithTasks.id,
        isLoading: false,
      });

      // 同步到 SessionHub
      get().createSession("chat", title, sessionWithTasks.id);

      return sessionWithTasks;
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(error, { module: 'stores:sessionSlice', action: 'createChatSession' }, 'warn');
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  switchChatSession: async (id: string) => {
    const prevId = get().currentSessionId;
    set({ switching: true, error: null });

    try {
      // 中止当前流 + flush 未持久化 blocks
      const { useChatStore } = await import("@/stores/chatStore");
      useChatStore.getState().stopMessage();
      await useChatStore.getState().flushPendingSaves();

      // 记录离开当前会话（用于回切摘要）
      if (prevId) {
        const prevMsgCount = useChatStore.getState().messages.length;
        import("@/components/ChatArea/ReEntryBanner").then((m) =>
          m.recordSessionLeave(prevId, prevMsgCount),
        );
      }

      const { sessionService } = await import("@/services/sessionService");
      const session = await sessionService.switch(id);

      // 获取消息（优先缓存）
      const { _getCachedMessages } = await import("@/stores/chatStore");
      const cached = _getCachedMessages(id);
      const messages = cached ?? await sessionService.getMessages(id);

      useChatStore.getState().setMessages(messages);

      // 清除路径缓存
      import("@/components/ChatArea/markdown/pathCache").then(m => m.clearPathCache());

      // 从消息中重建 sessionFiles
      const filePaths = new Set<string>();
      for (const msg of messages) {
        if (typeof msg.content === "string") {
          const matches = msg.content.match(/[a-zA-Z]:\\(?:[^\\\n\r]+\\)*[^\\\n\r]*\.[a-zA-Z0-9]+|\/(?:[^/\n\r]+\/)*[^/\n\r]*\.[a-zA-Z0-9]+/g);
          if (matches) matches.forEach(p => filePaths.add(p));
        }
        const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            const args = tc.arguments;
            if (typeof args === "string") {
              try {
                const parsed = JSON.parse(args);
                const fp = parsed.file_path || parsed.path || parsed.filePath;
                if (fp && typeof fp === "string") filePaths.add(fp);
              } catch { /* ignore parse errors */ }
            } else if (args && typeof args === "object") {
              const rargs = args as Record<string, unknown>;
              const fp = rargs.file_path || rargs.path || rargs.filePath;
              if (fp && typeof fp === "string") filePaths.add(fp);
            }
          }
        }
        const metadata = (msg as unknown as Record<string, unknown>).metadata;
        if (metadata && typeof metadata === "object") {
          const m = metadata as Record<string, unknown>;
          if (m.file_path && typeof m.file_path === "string") filePaths.add(m.file_path);
        }
      }
      const { inferFileType } = await import("@/stores/chatStore");
      for (const fp of filePaths) {
        const name = fp.split(/[/\\]/).pop() || fp;
        useChatStore.getState().addSessionFile({ path: fp, name, content: '', type: inferFileType(fp) });
      }

      set({ currentSessionId: id });
      // 同步到 SessionHub
      get().createSession("chat", session.title, id);

      // 懒加载恢复模型
      if (session.modelId) {
        try {
          const { modelSwitchService } = await import("@/services/modelSwitchService");
          const current = await modelSwitchService.getCurrent();
          if (current.modelId !== session.modelId) {
            await modelSwitchService.switch(session.modelId);
          }
        } catch (e) {
          const { handleClientError } = await import("@/utils/handleError");
          handleClientError(e, { module: 'stores:sessionSlice', action: 'switchChatSession:modelRestore' }, 'warn');
        }
      }

      // 刷新路由状态
      try {
        const { modelSwitchService } = await import("@/services/modelSwitchService");
        await modelSwitchService.getCurrent();
        const { useModelSwitchStore } = await import("@/stores/modelSwitchStore");
        useModelSwitchStore.getState().loadCurrent();
      } catch (e) {
        const { handleClientError } = await import("@/utils/handleError");
        handleClientError(e, { module: 'stores:sessionSlice', action: 'switchChatSession:refreshRoute' }, 'warn');
      }

      // 联动工作空间
      if (session.workspaceId) {
        try {
          const { useWorkspaceStore } = await import("@/stores/workspaceStore");
          const wsState = useWorkspaceStore.getState();
          if (wsState.currentWorkspace?.id !== session.workspaceId) {
            wsState.openWorkspace(session.workspaceId).catch(async (err: unknown) => {
              const { handleClientError } = await import("@/utils/handleError");
              handleClientError(err, { module: 'stores:sessionSlice', action: 'switchChatSession:workspaceLink' }, 'warn');
            });
          }
        } catch (e) {
          const { handleClientError } = await import("@/utils/handleError");
          handleClientError(e, { module: 'stores:sessionSlice', action: 'switchChatSession:workspaceLoad' }, 'warn');
        }
      }
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(error, { module: 'stores:sessionSlice', action: 'switchChatSession' }, 'warn');
      if (prevId) {
        set({ currentSessionId: prevId });
      }
      set({ error: String(error) });
    } finally {
      set({ switching: false });
    }
  },

  deleteChatSession: async (id: string) => {
    try {
      const { useChatStore } = await import("@/stores/chatStore");
      useChatStore.getState().stopMessage();
    } catch { /* ignore */ }

    set({ isLoading: true, error: null });
    try {
      const { sessionService } = await import("@/services/sessionService");
      await sessionService.delete(id);

      const sessions = get().chatSessions.filter((s) => s.id !== id);

      if (get().currentSessionId === id) {
        if (sessions[0]) {
          try {
            const messages = await sessionService.getMessages(sessions[0].id);
            const { useChatStore } = await import("@/stores/chatStore");
            useChatStore.getState().setMessages(messages);
          } catch { /* ignore */ }
          set({ chatSessions: sessions, currentSessionId: sessions[0].id, isLoading: false });
        } else {
          try {
            const { useChatStore } = await import("@/stores/chatStore");
            useChatStore.getState().clearMessages();
          } catch { /* ignore */ }
          set({ chatSessions: sessions, currentSessionId: null, isLoading: false });
        }
      } else {
        set({ chatSessions: sessions, isLoading: false });
      }

      // 同步删除 SessionHub 中的记录
      get().deleteSession(id);
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(error, { module: 'stores:sessionSlice', action: 'deleteChatSession' }, 'warn');
      set({ error: String(error), isLoading: false });
    }
  },

  renameChatSession: async (id: string, title: string) => {
    set({ isLoading: true, error: null });
    try {
      const { sessionService } = await import("@/services/sessionService");
      await sessionService.rename(id, title);
      const sessions = get().chatSessions.map((s) =>
        s.id === id ? { ...s, title, titleAutoGenerated: true } : s,
      );
      set({ chatSessions: sessions, isLoading: false });

      // 同步到 SessionHub
      get().renameSession(id, title);
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(error, { module: 'stores:sessionSlice', action: 'renameChatSession' }, 'warn');
      set({ error: String(error), isLoading: false });
    }
  },

  clearAllChatSessions: async () => {
    try {
      const { useChatStore } = await import("@/stores/chatStore");
      useChatStore.getState().stopMessage();
    } catch { /* ignore */ }

    set({ isLoading: true, error: null });
    try {
      const { sessionService } = await import("@/services/sessionService");
      await sessionService.clearAll();
      try {
        const { useChatStore } = await import("@/stores/chatStore");
        useChatStore.getState().clearMessages();
      } catch { /* ignore */ }
      set({ chatSessions: [], currentSessionId: null, isLoading: false });
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(error, { module: 'stores:sessionSlice', action: 'clearAllChatSessions' }, 'warn');
      set({ error: String(error), isLoading: false });
    }
  },
});

// ─── 辅助 ──────────────────────────────────────────────

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
