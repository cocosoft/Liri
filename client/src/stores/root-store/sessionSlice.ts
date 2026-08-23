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
import type { ModuleType } from "./moduleContextSlice";
import type { Message, Session } from "@/types";
import { createLogger } from "@/utils/logger";
import { useModelSwitchStore } from "../modelSwitchStore";
import { chatCoordinator } from "@/stores/chat/chatCoordinator";

const logger = createLogger("root-store:sessionSlice");

// P1-2 修复：会话切换序号。快速连点不同会话时，两次 switchChatSession 并行执行，
// 慢的请求后完成却无条件 set currentSessionId 覆盖最新目标（乱序覆盖竞态）。
// 每次切换取递增序号，写入状态前校验"本次仍是最新一次切换"，过期切换直接丢弃。
let _switchSeq = 0;

// G1 竞态修复：当前进行中的切换目标（供 deleteChatSession 判断"删除的是否为切换目标"）。
// 仅删除切换目标才需使其过期；删除其他会话不应误丢弃用户刚点的切换。
let _activeSwitchTarget: string | null = null;

// G2 竞态修复：进行中的"新建会话"Promise——快速双击"新建"时第二次调用复用同一
// Promise，避免并发创建两个会话（接口类型 Promise<Session> 保持不变）。
let _pendingCreate: Promise<Session> | null = null;

// N8 极致稳妥修复：恢复操作版本号——并发多个 restore 时新恢复抢占旧恢复，
// 旧恢复在任一 await 点校验失败即放弃，杜绝"旧恢复完成覆盖新目标"。
let _restoreSeq = 0;

// BUG-6 修复：loadChatSessions 的 isLoading 超时兜底——
// fetchWithRetry 最坏 3 次重试约 90s+，期间 isLoading 恒 true，SSE 触发的列表刷新
// 全部被早退拦截（删除会话残留、标题不更新）。记录加载开始时间，超过
// LOAD_TIMEOUT_MS 强制复位 isLoading 并允许下一次刷新继续。
const LOAD_TIMEOUT_MS = 10_000;
let loadStartedAt = 0;
/** T-2/A2 修复（2026-08-23）：isLoading 期间到达的刷新请求排队标记，加载完成后重跑一次 */
let _pendingSessionRefresh = false;

/**
 * E1 修复：切换被丢弃时，将 chat store 消息恢复为当前有效会话（currentSessionId）的内容。
 * 被丢弃的切换已执行 loadMessages(B) 把 B 的消息写入 store，但 currentSessionId 未变
 * → 出现"消息区显示被丢弃目标内容、侧栏高亮不一致"的短暂窗口。读取当前有效会话
 * 消息（缓存优先）恢复一致；无有效会话则清空。
 *
 * N8 极致稳妥：快照 + 版本号守卫 + 并发抢占（4 层防御）——
 * ① 快照当前会话/切换序号/恢复版本号；② 每个 await 点（动态 import、缓存、网络）
 * 后校验三者均未变化，把窗口压缩到"校验通过 → loadMessages"之间的同步代码
 * （零 await，无窗口）；③ 并发 restore 由 _restoreSeq 抢占；④ 期间任何新切换/新建/
 * 删除（都会 _switchSeq++）使恢复作废——恢复是"为被丢弃的切换善后"，期间发生新动作
 * 就该让位。
 */
async function restoreMessagesToCurrentSession(
  get: () => RootState,
): Promise<void> {
  // ① 快照：目标会话 + 切换序号 + 恢复版本号（三者任一变化 → 放弃本次恢复）
  const curId = get().currentSessionId;
  const switchSeqSnapshot = _switchSeq;
  const mySeq = ++_restoreSeq;
  const stillCurrent = (): boolean =>
    _restoreSeq === mySeq && // 没有被更新的恢复抢占
    get().currentSessionId === curId && // 会话没有变
    _switchSeq === switchSeqSnapshot; // 期间没有新切换/新建/删除开始
  try {
    const { sessionService } = await import("@/services/sessionService");
    if (!stillCurrent()) return; // ② await 后校验 1
    if (curId) {
      const { _getCachedMessages } = await import("@/stores/chat");
      if (!stillCurrent()) return; // ③ await 后校验 2
      const cached = _getCachedMessages(curId);
      if (cached) {
        if (!stillCurrent()) return;
        await chatCoordinator.loadMessages(cached);
      } else {
        // M2-3：优先从 events 派生，回退到 legacy messages
        const { messages } = await sessionService.loadConversation(curId);
        if (!stillCurrent()) return; // ④ 网络 await 后校验（关键窗口）
        await chatCoordinator.loadMessages(messages);
      }
    } else {
      await chatCoordinator.clearMessages().catch(() => {});
    }
  } catch {
    await chatCoordinator.clearMessages().catch(() => {});
  }
}

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
  createSession: (
    moduleType: string,
    title?: string,
    id?: string,
    workspaceIdOverride?: string,
  ) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (id: string, title: string) => void;
  updateSessionContext: (id: string, updates: Partial<SessionContext>) => void;
  getOrCreateSession: (moduleType: string, title?: string) => string;
  getSessionsByWorkspace: (workspaceId: string) => SessionRecord[];
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

export const createSessionSlice: StateCreator<
  RootState,
  [],
  [],
  SessionSlice
> = (set, get) => ({
  // ── 初始状态 ──
  sessions: {},
  currentSessionId: null,
  moduleOrder: [
    "chat",
    "media",
    "office",
    "calendar",
    "translation",
    "knowledge",
  ],
  pinnedSessionIds: [],
  error: null,
  isLoading: false,
  chatSessions: [],
  switching: false,

  // ─── SessionHub 动作 ────────────────────────────────

  createSession: (moduleType, title, overrideId, workspaceIdOverride) => {
    const wtId = workspaceIdOverride ?? get().currentWorkspaceId;
    const id =
      overrideId ??
      `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      workspaceId: wtId ?? "",
      title: title ?? `新${getNameByModuleType(moduleType)}`,
      createdAt: now,
      updatedAt: now,
      context,
    };

    set((state) => ({
      sessions: { ...state.sessions, [id]: session },
      currentSessionId: overrideId ? state.currentSessionId : id,
    }));

    logger.info("会话创建", { sessionId: id, moduleType, workspaceId: wtId });
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
      currentSessionId:
        state.currentSessionId === sessionId ? null : state.currentSessionId,
      pinnedSessionIds: state.pinnedSessionIds.filter((id) => id !== sessionId),
    }));
    logger.info("会话删除", { sessionId });
  },

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

  getOrCreateSession: (moduleType, title) => {
    const wtId = get().currentWorkspaceId;
    const wt = wtId ? get().worktrees[wtId] : undefined;

    // P1-3 修复：chat 模块直接复用当前会话。
    // 真实 chat 会话在 Hub 中的 workspaceId 是 ""（非项目会话后端不写
    // metadata.workspaceId，flattenSession 得到 undefined，loadChatSessions 用
    // `?? ""` 兜底），原逻辑按 workspaceId === "chat" 匹配永远失败，
    // 导致每次回 /chat 都新建一个仅存在于前端 Hub 的幽灵会话（sess-*，
    // persist 后永久累积），并把 currentSessionId 指向它 → 标题栏丢失会话。
    if (moduleType === "chat") {
      const currentId = get().currentSessionId;
      if (currentId) {
        const current = get().chatSessions.find((s) => s.id === currentId);
        // N5 修复：仅当当前会话属于 chat 模块才复用——项目会话（workspaceId 非空 /
        // Hub moduleType 为 project）也在 chatSessions 中，直接复用会导致 /chat 页
        // 显示项目会话、侧栏无高亮、消息区空白。
        const hubType = get().sessions[currentId]?.moduleType;
        const isChatSession =
          current &&
          (hubType === "chat" ||
            (hubType === undefined && !current.workspaceId));
        if (isChatSession) {
          logger.debug("getOrCreateSession:复用当前 chat 会话", {
            moduleType,
            sessionId: currentId,
            workspaceId: current?.workspaceId ?? null,
            hubType,
          });
          return currentId;
        }
        // N5 拦截：当前会话存在但不是 chat 模块（项目会话等），记录便于排查
        logger.info("getOrCreateSession:当前会话非 chat 模块，回退最近会话", {
          moduleType,
          currentSessionId: currentId,
          workspaceId: current?.workspaceId ?? null,
          hubType,
        });
      }
      // N2 修复：当前会话无效（如项目页 `SessionSliceList` 同步 switchSession 把
      // currentSessionId 指向项目会话，或指向已删除会话）→ 回退到 chatSessions
      // 最近会话（loadChatSessions 已按 updatedAt 降序），而非 fallthrough 新建
      // 幽灵会话——原实现导致项目页回 /chat 时 header 空白 + 幽灵记录累积。
      // N7 修复：回退目标必须是 chat 会话——chatSessions 来自 /v1/sessions 全量
      // 列表（含项目会话），若最近活跃的是项目会话，回退会指向它导致 /chat 页
      // 显示项目会话内容、侧栏（按 chat 过滤）无高亮。
      const latest = get().chatSessions.find(
        (s) =>
          !s.workspaceId &&
          (get().sessions[s.id]?.moduleType ?? "chat") === "chat",
      );
      if (latest) {
        set({ currentSessionId: latest.id });
        // BUG-1 修复：回退时同步加载该会话消息到 chat store——原实现只设
        // currentSessionId + fire-and-forget 同步后端，未加载消息 → 消息区仍显示
        // 项目会话旧消息（ChatMessageList 只按 messages.length 渲染，不校验
        // session_id 与 currentSessionId 一致性），与标题/侧栏高亮错位。
        // 与 switchChatSession 的 ③ 步一致（缓存优先；回退分支为同步函数，
        // 故 fire-and-forget 不阻塞导航）。N5 的 switch 同步一并保留。
        void (async () => {
          // R2 修复（复查 BUG-1 闭环）：加载消息加版本守卫——快照进入时的
          // _switchSeq，loadMessages 前校验未变化（与 restoreMessagesToCurrentSession
          // 的 N8 守卫同思路）。否则用户在网络加载期间点侧栏切到会话 B，
          // A 的 getMessages 后完成 → loadMessages(A) 覆盖 store →
          // currentSessionId=B 但消息区显示 A（BUG-1 同症状、不同路径）。
          const switchSeqSnapshot = _switchSeq;
          try {
            const { sessionService } =
              await import("@/services/sessionService");
            sessionService.switch(latest.id).catch(() => {});
            const { _getCachedMessages } = await import("@/stores/chat");
            const cached = _getCachedMessages(latest.id);
            // M2-3：优先从 events 派生，回退到 legacy messages
            const messages =
              cached ??
              (await sessionService.loadConversation(latest.id)).messages;
            // R2：期间发生新切换/新建/删除（都会 _switchSeq++）→ 放弃本次加载
            if (_switchSeq !== switchSeqSnapshot) return;
            await chatCoordinator.loadMessages(messages);
          } catch (e) {
            logger.warn("getOrCreateSession:回退加载消息失败", {
              sessionId: latest.id,
              error: String(e),
            });
          }
        })();
        logger.info("getOrCreateSession:回退到最近 chat 会话", {
          moduleType,
          sessionId: latest.id,
          title: latest.title,
          workspaceId: latest.workspaceId ?? null,
        });
        return latest.id;
      }
    }

    // 系统 worktree（chat 或 module）：复用该 worktree 下的当前模块会话，
    // 避免每次进入 /chat 等页面重复创建空会话
    if (wt?.workspaceSource === "system") {
      const existing = Object.values(get().sessions).find(
        (s) => s.workspaceId === wtId && s.moduleType === moduleType,
      );
      if (existing) {
        set({ currentSessionId: existing.id });
        logger.debug("getOrCreateSession:复用系统 worktree 会话", {
          moduleType,
          sessionId: existing.id,
          workspaceId: wtId,
        });
        return existing.id;
      }
    }

    // 用户项目 worktree（workspaceSource === "user"）：创建新会话（项目内多会话）
    logger.debug("getOrCreateSession:创建新会话", {
      moduleType,
      workspaceId: wtId,
      title: title ?? null,
    });
    return get().createSession(moduleType, title);
  },

  getSessionsByWorkspace: (workspaceId) =>
    Object.values(get().sessions).filter((s) => s.workspaceId === workspaceId),

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
    // P2-4 修复：早退条件从"列表非空"改为"正在加载"——原实现首次加载成功后
    // 所有后续调用都是 no-op，SSE（session:renamed/created/deleted/cleared）
    // 触发的列表刷新永远不生效，侧栏标题/列表必须刷新页面才更新。
    if (get().isLoading) {
      // BUG-6 修复：加载超时兜底——上次加载超过 10s 未完成（网络卡死/重试中）
      // 时强制复位 isLoading 并继续本次刷新，避免 SSE 刷新长期失效
      if (loadStartedAt && Date.now() - loadStartedAt > LOAD_TIMEOUT_MS) {
        logger.warn("loadChatSessions:加载超时，强制复位 isLoading", {
          elapsedMs: Date.now() - loadStartedAt,
        });
        loadStartedAt = 0;
        set({ isLoading: false });
      } else {
        // T-2/A2 修复（2026-08-23）：SSE 刷新不再静默丢弃——排队标记，当前加载完成后
        // 重跑一次（合并多次为一次）。原实现直接 return，session:renamed（标题/列表
        // 变更）在加载窗口内被丢弃，表现为"标题需重开页面才显示"。
        _pendingSessionRefresh = true;
        logger.debug("loadChatSessions:加载中，排队本次刷新");
        return;
      }
    }
    set({ isLoading: true, error: null });
    loadStartedAt = Date.now();
    try {
      const { sessionService } = await import("@/services/sessionService");
      let sessions = await sessionService.list();
      sessions = sessions.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      const currentSession = await sessionService.getCurrent();

      // Hub 同步：moduleType 从 API metadata 或现有 Hub 读取，不再硬编码 "chat"
      // projectId 从 metadata 读取；workspaceId 使用 resolveWorkspaceId 统一计算
      const hubSync: Record<string, SessionRecord> = {};
      for (const s of sessions) {
        const existing = get().sessions[s.id];
        const md = s.metadata as Record<string, unknown> | undefined;
        hubSync[s.id] = {
          id: s.id,
          moduleType:
            (md?.moduleType as ModuleType) ?? existing?.moduleType ?? "chat",
          projectId: (md?.projectId as string) ?? existing?.projectId,
          workspaceId: s.workspaceId ?? "",
          title: s.title,
          createdAt: new Date(s.createdAt).getTime(),
          updatedAt: new Date(s.updatedAt).getTime(),
          context: {
            moduleType: "chat" as const,
            modelId: s.modelId,
            agentId: s.agentId,
          },
        };
      }

      // N6 修复：切换进行中（switching=true）不覆盖 currentSessionId——
      // SSE 回环（autoGenerateTitle 等广播 session:renamed → 本端 SSE → loadChatSessions）
      // 可穿透 switchChatSession（它只设 switching、不设 isLoading）。若 getCurrent()
      // 响应乱序（返回旧会话 A）会覆盖切换目标 B → 用户点了 B 却停在 A。
      const switching = get().switching;
      // L7 修复（会话系统排查 2026-08-13）：后端 current 返回的会话 id 可能不在
      // 列表中（跨端删除场景），直接采用会指向幽灵会话——消息区空白且列表无高亮
      // （switchChatSession 已有 G5 存在性校验，但首次加载/SSE 刷新路径此前无校验）。
      // 不在列表时回退到列表第一个（sessions 已按 updatedAt 降序，第一个最新活跃）。
      let resolvedCurrentId = currentSession?.id ?? null;
      if (
        !switching &&
        resolvedCurrentId &&
        !sessions.some((s) => s.id === resolvedCurrentId)
      ) {
        logger.warn("loadChatSessions:current 返回幽灵会话，回退最近会话", {
          ghostId: resolvedCurrentId,
          sessionCount: sessions.length,
          fallbackId: sessions[0]?.id ?? null,
        });
        resolvedCurrentId = sessions[0]?.id ?? null;
      } else if (!switching && !resolvedCurrentId) {
        // 排查日志：后端无当前会话（current 为 null 或列表为空），
        // 与幽灵回退区分——确认"无当前会话"是正常空列表而非识别失败
        logger.debug("loadChatSessions:无当前会话（current 为空）", {
          sessionCount: sessions.length,
        });
      } else if (!switching && resolvedCurrentId) {
        // 排查日志：校验通过路径（id 在列表中），与幽灵回退对照
        logger.debug("loadChatSessions:current id 校验通过", {
          currentSessionId: resolvedCurrentId,
          sessionCount: sessions.length,
        });
      }
      set({
        chatSessions: sessions,
        currentSessionId: switching
          ? get().currentSessionId
          : resolvedCurrentId,
        isLoading: false,
        sessions: { ...get().sessions, ...hubSync },
      });
      loadStartedAt = 0; // BUG-6：加载完成复位超时计时
      // T-2/A2 修复：加载期间排队的刷新在此重跑（合并多次为一次）
      if (_pendingSessionRefresh) {
        _pendingSessionRefresh = false;
        logger.debug("loadChatSessions:重跑排队的刷新");
        void get().loadChatSessions();
      }
      logger.info("loadChatSessions:加载完成", {
        sessionCount: sessions.length,
        currentSessionId: currentSession?.id ?? null,
        hubSynced: Object.keys(hubSync).length,
        switching,
      });

      // N6 修复：切换进行中跳过补拉——switchChatSession 会自行 stopAndFlush +
      // getMessages + loadMessages，此处补拉会与其竞态覆盖。
      if (switching) {
        logger.debug("loadChatSessions:切换进行中，跳过补拉消息", {
          switching,
        });
        return;
      }

      // N3 修复：刷新页面后当前会话消息不自动加载 → 消息区空白，必须点侧栏才恢复。
      // loadChatSessions 只设列表 + currentSessionId，不拉消息；chat store 无 persist、
      // _sessionMessageCache 是内存 Map（刷新即失）。set 后若 chat store 中没有
      // 当前会话的消息（空列表或首条 session_id 不匹配），补拉一次（缓存优先）。
      // L7：补拉目标用解析后的 resolvedCurrentId（幽灵校验后的有效 id），
      // 避免用幽灵 id 拉取失败/空。
      const currentId = resolvedCurrentId;
      if (currentId) {
        // chat store 独立于 rootStore（高频 IO），动态读取避免静态循环依赖
        const { useChatStore } = await import("@/stores/chat");
        const msgs = useChatStore.getState().messages;
        const hasCurrentMsgs =
          msgs.length > 0 && msgs[0].session_id === currentId;
        if (!hasCurrentMsgs) {
          try {
            const { _getCachedMessages } = await import("@/stores/chat");
            const cached = _getCachedMessages(currentId);
            // ⚠ 修复（2026-08-23）：统一走 loadConversation（events 优先 + legacy 合并），
            // 原用 getMessages 直接读 messages.jsonl——历史会话的首条用户消息可能只存在于
            // events.jsonl（写前落盘失败场景），getMessages 返回缺失首条的消息导致前端不显示。
            // loadConversation 的 events 派生含完整首条用户消息，且 events 损坏时自动合并 legacy。
            const messages =
              cached ??
              (await sessionService.loadConversation(currentId)).messages;
            await chatCoordinator.loadMessages(messages);
            logger.debug("loadChatSessions:补拉当前会话消息", {
              sessionId: currentId,
              fromCache: cached != null,
              messageCount: messages.length,
            });
          } catch (e) {
            // 拉取失败不影响列表展示，保持静默
            logger.debug("loadChatSessions:补拉当前会话消息失败", {
              sessionId: currentId,
              error: String(e),
            });
          }
        } else {
          logger.debug(
            "loadChatSessions:chat store 已有当前会话消息，跳过补拉",
            {
              sessionId: currentId,
              messageCount: msgs.length,
            },
          );
        }
      }
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(
        error,
        { module: "stores:sessionSlice", action: "loadChatSessions" },
        "warn",
      );
      set({ error: String(error), isLoading: false });
      loadStartedAt = 0; // BUG-6：加载失败复位超时计时
    }
  },

  createChatSession: (title: string) => {
    // G2 竞态修复：复用进行中的创建——快速双击"新建"时第二次调用返回同一 Promise，
    // 不并发创建两个会话（原实现无防护，接口 Promise<Session> 保持不变）。
    if (_pendingCreate) {
      logger.debug("createChatSession:创建进行中，复用同一 Promise", { title });
      return _pendingCreate;
    }
    logger.debug("创建会话:", title);
    const promise = (async () => {
      // 时序日志基准：t0 = 本次创建起点；seq = 进入时的切换序号（G1 递增后），
      // 用于区分并发实例的执行顺序
      const t0 = performance.now();
      // G1 竞态修复：递增切换序号使进行中的 switchChatSession 过期——否则切换 B
      // 进行中点击"新建"（C 已 set currentSessionId=C）后，switch B 完成仍会
      // set currentSessionId=B 覆盖新会话；同时清掉旧切换的 switching（过期 switch
      // 的 finally 不再重置，需在此兜底）。
      const seq = ++_switchSeq;
      set({ switching: false, isLoading: true, error: null });
      logger.info("createChatSession:①开始", {
        seq,
        title,
        t: (performance.now() - t0).toFixed(0),
      });
      try {
        const { sessionService } = await import("@/services/sessionService");

        // 获取当前后端生效模型
        let modelId: string | undefined;
        try {
          const { modelSwitchService } =
            await import("@/services/modelSwitchService");
          const current = await modelSwitchService.getCurrent();
          // 会话 modelId 统一存 UUID（model_registry.id），与切换/恢复接口对齐；
          // 老后端无 modelUuid 时回退模型名
          modelId = current.modelUuid || current.modelId;
          logger.info("createChatSession:②模型已获取", {
            seq,
            modelId,
            t: (performance.now() - t0).toFixed(0),
          });
        } catch (e) {
          logger.warn("createChatSession:②获取模型失败", {
            seq,
            error: String(e),
            t: (performance.now() - t0).toFixed(0),
          });
          const { handleClientError } = await import("@/utils/handleError");
          handleClientError(
            e,
            {
              module: "stores:sessionSlice",
              action: "createChatSession:getModelId",
            },
            "warn",
          );
        }

        // 获取任务分工配置
        let tasksOverride: Record<string, string> | undefined;
        try {
          const { modelSwitchService } =
            await import("@/services/modelSwitchService");
          const tasks = await modelSwitchService.getTasks();
          tasksOverride = tasks as Record<string, string>;
        } catch (e) {
          const { handleClientError } = await import("@/utils/handleError");
          handleClientError(
            e,
            {
              module: "stores:sessionSlice",
              action: "createChatSession:getTasks",
            },
            "warn",
          );
        }

        // 获取当前工作空间 — 从 moduleContext 读取，不再依赖 currentWorkspaceId
        const ctx = get().moduleContext;
        const workspaceId =
          ctx.moduleType === "project" ? ctx.projectId : undefined;
        // P2-2: workspacePath 应为真实 sandboxPath（worktree.path），而非项目名
        const workspacePath =
          ctx.moduleType === "project" && ctx.projectId
            ? get().worktrees[ctx.projectId]?.path
            : undefined;

        const session = await sessionService.create(title, {
          modelId,
          workspaceId,
          workspacePath,
          moduleType: ctx.moduleType,
          projectId: ctx.projectId,
        });
        const sessionWithTasks: Session = tasksOverride
          ? {
              ...session,
              tasksOverride: tasksOverride as unknown as Partial<
                import("@/types/model").TaskModelConfig
              >,
            }
          : session;

        logger.info("createChatSession:③后端会话已创建", {
          seq,
          sessionId: session.id,
          t: (performance.now() - t0).toFixed(0),
        });
        logger.debug("会话已创建: " + session.id, { modelId, workspaceId });

        // P2-1 修复：新建会话前先停止旧流 + 落盘待保存 blocks（与 switchChatSession
        // 的 stopAndFlush 一致）。原实现只 clearMessages（仅 set({ messages: [] })），
        // 不 abort streamControllers → 旧流后台继续跑完（持续消耗 token），
        // 且因 messages 已清空，停止按钮（stopMessageImpl 按 messages[0].session_id
        // 找 controller）也定位不到旧流，变成"无法停止"。
        try {
          await chatCoordinator.stopAndFlush();
          logger.info("createChatSession:④旧流已停止并落盘", {
            seq,
            newSessionId: session.id,
            t: (performance.now() - t0).toFixed(0),
          });
        } catch (e) {
          logger.warn("createChatSession:④stopAndFlush 失败", {
            seq,
            newSessionId: session.id,
            error: String(e),
            t: (performance.now() - t0).toFixed(0),
          });
          const { handleClientError } = await import("@/utils/handleError");
          handleClientError(
            e,
            {
              module: "stores:sessionSlice",
              action: "createChatSession:stopAndFlush",
            },
            "warn",
          );
        }

        // 清空 chatStore 消息
        try {
          await chatCoordinator.clearMessages();
        } catch (e) {
          const { handleClientError } = await import("@/utils/handleError");
          handleClientError(
            e,
            {
              module: "stores:sessionSlice",
              action: "createChatSession:clearMessages",
            },
            "warn",
          );
        }

        // 重新加载会话列表
        let sessions = await sessionService.list();
        sessions = sessions.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );

        set({
          chatSessions: sessions,
          currentSessionId: sessionWithTasks.id,
          isLoading: false,
        });
        logger.info("createChatSession:⑤状态已更新", {
          seq,
          sessionId: sessionWithTasks.id,
          t: (performance.now() - t0).toFixed(0),
        });

        // 同步到 SessionHub：注入 moduleType + projectId（从 moduleContext 读取）
        get().createSession(
          ctx.moduleType,
          title,
          sessionWithTasks.id,
          sessionWithTasks.workspaceId ?? "",
        );

        logger.info("createChatSession:✅完成", {
          seq,
          sessionId: sessionWithTasks.id,
          totalMs: (performance.now() - t0).toFixed(0),
        });
        return sessionWithTasks;
      } catch (error) {
        logger.warn("createChatSession:❌失败", {
          seq,
          error: String(error),
          t: (performance.now() - t0).toFixed(0),
        });
        const { handleClientError } = await import("@/utils/handleError");
        handleClientError(
          error,
          { module: "stores:sessionSlice", action: "createChatSession" },
          "warn",
        );
        // W1 修复：handleClientError 仅记日志不弹 toast——后端不可用时
        // 用户必须能看到"创建失败"而不是误以为成功，故追加 toast
        const { toastError } = await import("@/stores/toastStore");
        toastError(error);
        set({ error: String(error), isLoading: false });
        throw error;
      }
    })(); // 结束 async IIFE
    // G2：注册进行中的创建，完成后清理（用引用比较防并发覆盖）
    _pendingCreate = promise;
    promise.finally(() => {
      if (_pendingCreate === promise) _pendingCreate = null;
    });
    return promise;
  },

  switchChatSession: async (id: string) => {
    const t0 = performance.now();
    // P1-2：记录本次切换序号，供后续"仍是最新一次切换"校验
    const seq = ++_switchSeq;
    // G1：记录进行中的切换目标（deleteChatSession 据此精确过期）
    _activeSwitchTarget = id;
    const prevId = get().currentSessionId;
    // 时序日志（非 DEV 也输出，便于运行时观察并发顺序；seq 区分并发实例）
    logger.info("switchChatSession:①开始", {
      seq,
      sessionId: id,
      prevId: prevId ?? null,
      t: 0,
    });
    if (import.meta.env.DEV)
      console.info("[Diag:switch] ═══ 开始切换会话", {
        sessionId: id,
        prevId,
        t0,
      });
    set({ switching: true, error: null });

    try {
      // 中止当前流 + flush 未持久化 blocks
      const t1 = performance.now();
      const msgs = await chatCoordinator.stopAndFlush();
      if (import.meta.env.DEV)
        console.info("[Diag:switch] ① stopMessage + flushPendingSaves", {
          ms: (performance.now() - t1).toFixed(1),
        });

      // 记录离开当前会话（用于回切摘要）
      if (prevId) {
        const lastMsgId = msgs.length > 0 ? msgs[msgs.length - 1].id : null;
        import("@/components/ChatArea/ReEntryBanner")
          .then((m) => m.recordSessionLeave(prevId, lastMsgId))
          .catch(() => {
            /* ReEntryBanner 动态加载失败，静默忽略 */
          });
      }

      const t2 = performance.now();
      const { sessionService } = await import("@/services/sessionService");
      const session = await sessionService.switch(id);
      logger.info("switchChatSession:②后端切换完成", {
        seq,
        sessionId: id,
        title: session?.title ?? null,
        hasWorkspace: !!session?.workspaceId,
        t: (performance.now() - t0).toFixed(0),
      });
      if (import.meta.env.DEV)
        console.info("[Diag:switch] ② POST /v1/sessions/:id/switch", {
          ms: (performance.now() - t2).toFixed(1),
          title: session?.title,
          hasWorkspace: !!session?.workspaceId,
        });

      // 获取消息（优先缓存 → A1：未命中时走 loadConversation 增量 events 派生）
      const t3 = performance.now();
      const { _getCachedMessages } = await import("@/stores/chat");
      const cached = _getCachedMessages(id);
      const fromCache = cached != null;
      let messages: Message[];
      if (fromCache) {
        messages = cached as Message[];
      } else {
        // A1：走 loadConversation（events 增量 → 纯函数派生），与流式渲染路径一致
        const loaded = await sessionService.loadConversation(id);
        messages = loaded.messages;
      }
      logger.info("switchChatSession:③消息已加载", {
        seq,
        sessionId: id,
        count: messages.length,
        fromCache,
        source: fromCache ? "memory-cache" : "events-incremental",
        t: (performance.now() - t0).toFixed(0),
      });
      if (import.meta.env.DEV)
        console.info("[Diag:switch] ③ getMessages", {
          ms: (performance.now() - t3).toFixed(1),
          count: messages.length,
          fromCache,
        });

      const t4 = performance.now();
      await chatCoordinator.loadMessages(messages);
      logger.info("switchChatSession:④setMessages 完成", {
        seq,
        sessionId: id,
        t: (performance.now() - t0).toFixed(0),
      });
      if (import.meta.env.DEV)
        console.info("[Diag:switch] ④ setMessages 完成", {
          ms: (performance.now() - t4).toFixed(1),
        });

      // 清除路径缓存
      import("@/components/ChatArea/markdown/pathCache")
        .then((m) => m.clearPathCache())
        .catch(() => {
          /* pathCache 动态加载失败，静默忽略 */
        });

      // 懒加载恢复模型
      if (session.modelId) {
        try {
          const t6 = performance.now();
          const { modelSwitchService } =
            await import("@/services/modelSwitchService");
          const current = await modelSwitchService.getCurrent();
          // 用 UUID 比较（current.modelUuid 是 UUID，session.modelId 是 UUID）
          // P3-8 修复：老后端无 modelUuid 时回退比较 modelId（模型名），
          // 避免 current.modelUuid 为 undefined 时静默跳过模型恢复
          const currentModelId = current.modelUuid ?? current.modelId;
          if (currentModelId && currentModelId !== session.modelId) {
            await modelSwitchService.switch(session.modelId);
          }
          if (import.meta.env.DEV)
            console.info("[Diag:switch] ⑥ 模型恢复", {
              ms: (performance.now() - t6).toFixed(1),
              modelId: session.modelId,
            });
        } catch (e) {
          if (import.meta.env.DEV)
            logger.warn("[Diag:switch] ⑥ 模型恢复失败", e);
          const { handleClientError } = await import("@/utils/handleError");
          handleClientError(
            e,
            {
              module: "stores:sessionSlice",
              action: "switchChatSession:modelRestore",
            },
            "warn",
          );
        }
      } else {
        if (import.meta.env.DEV)
          console.info("[Diag:switch] ⑥ 模型恢复跳过（无 modelId）");
      }

      // 刷新路由状态（异步 fire-and-forget、不阻塞会话切换）
      const t7 = performance.now();
      useModelSwitchStore
        .getState()
        .loadCurrent()
        .catch(() => {
          /* 静默失败：路由刷新不影响会话切换 */
        });
      if (import.meta.env.DEV)
        console.info("[Diag:switch] ⑦ 路由刷新", {
          ms: (performance.now() - t7).toFixed(1),
        });

      // 联动工作空间
      if (session.workspaceId) {
        try {
          const { useWorkspaceStore } = await import("@/stores/workspaceStore");
          const wsState = useWorkspaceStore.getState();
          if (wsState.currentWorkspace?.id !== session.workspaceId) {
            wsState
              .openWorkspace(session.workspaceId)
              .catch(async (err: unknown) => {
                const { handleClientError } =
                  await import("@/utils/handleError");
                handleClientError(
                  err,
                  {
                    module: "stores:sessionSlice",
                    action: "switchChatSession:workspaceLink",
                  },
                  "warn",
                );
              });
          }
        } catch (e) {
          const { handleClientError } = await import("@/utils/handleError");
          handleClientError(
            e,
            {
              module: "stores:sessionSlice",
              action: "switchChatSession:workspaceLoad",
            },
            "warn",
          );
        }
      }

      // 更新当前会话 ID + 同步 SessionHub（最后执行，触发 React 渲染）
      // P1-2：写入前校验本次仍是最新一次切换——若期间用户又点了其他会话，
      // 本次的 getMessages/loadMessages 等副作用已被后续切换打断，直接丢弃，
      // 避免慢请求后完成覆盖最新目标（乱序覆盖竞态）。
      if (seq !== _switchSeq) {
        logger.info("switchChatSession:过期切换被丢弃（乱序竞态防护）", {
          sessionId: id,
          seq,
          latestSeq: _switchSeq,
        });
        if (import.meta.env.DEV)
          console.info("[Diag:switch] ⏭ 过期切换被丢弃", {
            sessionId: id,
            seq,
            latestSeq: _switchSeq,
          });
        // E1 修复：丢弃前把消息区恢复为当前有效会话（本切换的 loadMessages(B)
        // 已写入 store 但 currentSessionId 未变 → 消息区与侧栏不一致窗口）
        await restoreMessagesToCurrentSession(get);
        return;
      }
      // G5 竞态修复：目标会话已不在列表（await 期间被删除/清空）→ 丢弃本次切换。
      // 侧栏渲染基于 chatSessions，目标必然曾存在；此刻不在 = 列表已刷新（SSE
      // session:deleted/cleared 触发）且目标已删，set currentSessionId 会残留幽灵。
      // 列表状态已由 loadChatSessions 纠正，直接丢弃即可。
      if (!get().chatSessions.some((s) => s.id === id)) {
        logger.info("switchChatSession:目标会话已不在列表，丢弃切换", {
          sessionId: id,
          seq,
        });
        // E1 修复：同上，丢弃前恢复消息区一致性
        await restoreMessagesToCurrentSession(get);
        return;
      }
      const t5 = performance.now();
      set({ currentSessionId: id });
      logger.info("switchChatSession:⑤状态已更新", {
        seq,
        sessionId: id,
        t: (performance.now() - t0).toFixed(0),
      });
      // 同步 SessionHub：以「后端 workspaceId」为权威标记会话归属，而非当前
      // currentWorkspaceId —— 防止在项目 worktree 上下文中切换普通会话时
      // 被误标为用户项目会话（导致 /chat 页侧栏过滤隐藏）。
      // 同时保留已有记录的模块类型，避免切换项目会话时被误标为 chat（projectId 由 workspaceId 兜底）。
      const existingHub = get().sessions[id];
      // R-C 修复：合并更新而非 createSession 重建——createSession 全新构造
      // 默认 context，切一次会话 projectId/context.modelId/context.agentId 等
      // 原有字段就被覆盖丢失（loadChatSessions 从 metadata 同步的 Hub 数据被冲掉）。
      // 合并仅更新后端权威字段（moduleType/title/workspaceId），保留已有 context。
      const moduleType = existingHub?.moduleType ?? "chat";
      set((state) => {
        const prev = state.sessions[id];
        return {
          sessions: {
            ...state.sessions,
            [id]: {
              ...(prev ?? { id }),
              id,
              moduleType,
              title:
                session.title ??
                prev?.title ??
                `新${getNameByModuleType(moduleType)}`,
              workspaceId:
                session.workspaceId ??
                existingHub?.workspaceId ??
                prev?.workspaceId ??
                "",
              updatedAt: Date.now(),
            },
          },
        };
      });
      if (import.meta.env.DEV)
        console.info("[Diag:switch] ⑤ store 更新 + SessionHub 同步", {
          ms: (performance.now() - t5).toFixed(1),
        });

      if (import.meta.env.DEV)
        console.info("[Diag:switch] ✅ 切换完成（数据就绪）", {
          sessionId: id,
          totalMs: (performance.now() - t0).toFixed(1),
        });
      logger.info("switchChatSession:✅完成", {
        seq,
        sessionId: id,
        totalMs: (performance.now() - t0).toFixed(0),
      });
    } catch (error) {
      logger.warn("switchChatSession:❌失败", {
        seq,
        sessionId: id,
        error: String(error),
        t: (performance.now() - t0).toFixed(0),
      });
      if (import.meta.env.DEV)
        logger.error("[Diag:switch] ❌ 切换失败", {
          sessionId: id,
          error: String(error),
          totalMs: (performance.now() - t0).toFixed(1),
        });

      // N1 修复：目标会话不存在（sessionService.switch 对 404 抛出）——
      // 原实现静默降级内存假会话导致"空壳会话复活"。此处清理残留（chatSessions
      // + SessionHub + pinned + 消息缓存）并切到最近会话，避免幽灵项残留。
      const isNotFound =
        error instanceof Error &&
        (error as unknown as { statusCode?: number }).statusCode === 404;
      if (isNotFound && seq === _switchSeq) {
        const remaining = get().chatSessions.filter((s) => s.id !== id);
        const next = remaining[0] ?? null;
        logger.info("switchChatSession:目标会话不存在(404)，清理残留并切换", {
          sessionId: id,
          remainingCount: remaining.length,
          nextSessionId: next?.id ?? null,
          seq,
        });
        set({
          chatSessions: remaining,
          currentSessionId: next?.id ?? null,
        });
        const { [id]: _removed, ...restSessions } = get().sessions;
        set({
          sessions: restSessions,
          pinnedSessionIds: get().pinnedSessionIds.filter((p) => p !== id),
        });
        try {
          const { staleSessionCache } =
            await import("@/stores/chat/chat-history.slice");
          staleSessionCache(id);
        } catch {
          /* 缓存清理失败不影响 */
        }
        if (next) {
          try {
            const { sessionService } =
              await import("@/services/sessionService");
            // N4 修复：同步后端 currentId——原实现只 getMessages + loadMessages，
            // 后端 404 时 currentId 仍保持旧值，刷新后 getCurrentSession 返回旧值
            // 导致 currentSessionId 漂移。
            await sessionService.switch(next.id).catch(() => {});
            // ⚠ 统一走 loadConversation（events 优先 + legacy 合并），确保首条用户消息等
            // 仅存在于 events.jsonl 的消息被加载（getMessages 只读 messages.jsonl，可能缺失）。
            const messages = (await sessionService.loadConversation(next.id))
              .messages;
            await chatCoordinator.loadMessages(messages);
            logger.debug("switchChatSession:404 清理后已切到最近会话", {
              sessionId: id,
              nextSessionId: next.id,
              messageCount: messages.length,
            });
          } catch (e) {
            logger.warn("switchChatSession:404 清理后加载最近会话失败", {
              sessionId: id,
              nextSessionId: next.id,
              error: String(e),
            });
            await chatCoordinator.clearMessages().catch(() => {});
          }
        } else {
          await chatCoordinator.clearMessages().catch(() => {});
        }
        set({ error: null });
        return;
      }

      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(
        error,
        { module: "stores:sessionSlice", action: "switchChatSession" },
        "warn",
      );
      // P13: 仅当当前会话仍是切换目标时才回退（防止并发切换覆盖）
      // P1-2: 仅最新一次切换处理错误——过期切换的失败不覆盖新切换的错误状态
      if (seq === _switchSeq) {
        if (prevId && get().currentSessionId === id) {
          set({ currentSessionId: prevId });
        }
        set({ error: String(error) });
      }
    } finally {
      // G1：清除进行中的切换目标标记
      if (_activeSwitchTarget === id) {
        _activeSwitchTarget = null;
      }
      // P1-2: 仅最新切换负责重置 switching，防止过期切换提前清掉新切换的 loading 指示
      if (seq === _switchSeq) {
        set({ switching: false });
      }
    }
  },

  deleteChatSession: async (id: string) => {
    // G1 竞态修复：仅当删除的是**进行中切换的目标**时才使该 switch 过期——
    // 切换 B 进行中删除 B，switch B 完成后再 set currentSessionId=B 会残留幽灵；
    // 删除其他会话不影响进行中的切换（不过度丢弃用户刚点的切换）。
    if (_activeSwitchTarget === id) {
      _switchSeq++;
      set({ switching: false });
      logger.info("deleteChatSession:删除进行中切换的目标，使该切换过期", {
        sessionId: id,
      });
    }
    try {
      await chatCoordinator.stopMessage();
    } catch {
      /* ignore */
    }
    // 阶段2：删除会话时放弃其挂起流（中止控制器 + 解除挂起等待 + 清理暂停状态，
    // 防止等待者 / ghostCheck 定时器 / 控制器永久泄漏）。幂等：未挂起则无操作。
    await chatCoordinator.abortPausedStream(id).catch(() => {});

    set({ isLoading: true, error: null });
    try {
      const { sessionService } = await import("@/services/sessionService");
      await sessionService.delete(id);
      logger.info("deleteChatSession:删除成功", { sessionId: id });

      // R-K 修复：删除会话后清除其消息缓存，防止残留（切回时拉到幽灵数据）
      const { staleSessionCache } =
        await import("@/stores/chat/chat-history.slice");
      staleSessionCache(id);

      const sessions = get().chatSessions.filter((s) => s.id !== id);

      if (get().currentSessionId === id) {
        if (sessions[0]) {
          logger.info("deleteChatSession:当前会话被删，切到最近会话", {
            deletedSessionId: id,
            nextSessionId: sessions[0].id,
          });
          // P3-3 修复：同步通知后端切换当前会话——原实现仅更新前端
          // currentSessionId，后端 currentId 仍指向已删除的会话（置 null），
          // 重启后当前会话丢失。fire-and-forget，不阻塞删除流程。
          sessionService.switch(sessions[0].id).catch(async (e) => {
            const { handleClientError } = await import("@/utils/handleError");
            handleClientError(
              e,
              {
                module: "stores:sessionSlice",
                action: "deleteChatSession:switchNext",
              },
              "warn",
            );
          });
          try {
            // ⚠ 统一走 loadConversation（events 优先 + legacy 合并），确保完整消息加载
            const messages = (
              await sessionService.loadConversation(sessions[0].id)
            ).messages;
            await chatCoordinator.loadMessages(messages);
          } catch (e) {
            // #10 修复：getMessages 失败不再静默——仍切走目标会话但清空消息，
            // 避免 UI 错位显示已删除会话的内容，并记录错误便于排查
            const { handleClientError } = await import("@/utils/handleError");
            handleClientError(
              e,
              {
                module: "stores:sessionSlice",
                action: "deleteChatSession:loadNext",
              },
              "warn",
            );
            await chatCoordinator.loadMessages([]).catch(() => {});
          }
          // 重新从当前状态获取 sessions，防止并发修改
          // BUG-5 修复：currentSessionId 用 set 内重新 filter 的最新列表——
          // 原实现用 await 前捕获的 sessions（L1131），期间若 SSE 刷新列表
          // （新会话插入头部），切到的可能不是真正最新的会话。
          const nextList = get().chatSessions.filter((s) => s.id !== id);
          set({
            chatSessions: nextList,
            currentSessionId: nextList[0]?.id ?? null,
            isLoading: false,
          });
        } else {
          try {
            await chatCoordinator.clearMessages();
          } catch {
            /* ignore */
          }
          set({
            chatSessions: get().chatSessions.filter((s) => s.id !== id),
            currentSessionId: null,
            isLoading: false,
          });
        }
      } else {
        set({
          chatSessions: get().chatSessions.filter((s) => s.id !== id),
          isLoading: false,
        });
      }

      // 同步删除 SessionHub 中的记录
      get().deleteSession(id);
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(
        error,
        { module: "stores:sessionSlice", action: "deleteChatSession" },
        "warn",
      );
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
      logger.info("renameChatSession:重命名成功", { sessionId: id, title });
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(
        error,
        { module: "stores:sessionSlice", action: "renameChatSession" },
        "warn",
      );
      logger.warn("renameChatSession:重命名失败", {
        sessionId: id,
        title,
        error: String(error),
      });
      set({ error: String(error), isLoading: false });
    }
  },

  clearAllChatSessions: async () => {
    // G1 竞态修复：递增切换序号使进行中的 switchChatSession 过期（同 deleteChatSession）
    _switchSeq++;
    try {
      await chatCoordinator.stopMessage();
    } catch {
      /* ignore */
    }

    // switching 兜底：被过期的 switch 的 finally 不再重置 switching，此处清掉
    set({ switching: false, isLoading: true, error: null });
    try {
      const { sessionService } = await import("@/services/sessionService");
      // P2-2 修复：逐个删除 chat 会话，不再调用 clearAll（DELETE /v1/sessions）。
      // 后端 clearAllSessions 会删除磁盘上所有会话（不限模块），项目会话也在磁盘上，
      // 前端却只清 Hub 的 chat 记录 → 项目会话数据被误删，前端残留记录点击后
      // 触发后端"幽灵复活"成空壳。逐个 delete 只影响目标 chat 会话，前后端作用域一致。
      const targets = get().chatSessions.map((s) => s.id);
      logger.info("clearAllChatSessions:开始逐个删除 chat 会话", {
        targetCount: targets.length,
      });
      // 阶段2：清空会话前先放弃全部挂起流（stopMessage 只停当前 UI 会话，
      // 非当前会话的挂起流需在此清理，防止等待者/控制器/ghostCheck 定时器泄漏）
      await Promise.all(
        targets.map((id) =>
          chatCoordinator.abortPausedStream(id).catch(() => {}),
        ),
      );
      await Promise.all(
        targets.map((id) =>
          sessionService.delete(id).catch(async (e) => {
            logger.warn("clearAllChatSessions:删除单个会话失败", {
              sessionId: id,
              error: String(e),
            });
            const { handleClientError } = await import("@/utils/handleError");
            handleClientError(
              e,
              {
                module: "stores:sessionSlice",
                action: "clearAllChatSessions:delete",
              },
              "warn",
            );
          }),
        ),
      );
      try {
        await chatCoordinator.clearMessages();
      } catch {
        /* ignore */
      }
      set({ chatSessions: [], currentSessionId: null, isLoading: false });
      logger.info("clearAllChatSessions:清空完成", {
        targetCount: targets.length,
      });

      // P1: 同步清除 SessionHub 中的 chat 会话（保留其他模块会话）
      const nonChatSessions = Object.fromEntries(
        Object.entries(get().sessions).filter(
          ([, v]) => v.moduleType !== "chat",
        ),
      );
      set({
        sessions: nonChatSessions,
        // P3-4 修复：同步清理 pinnedSessionIds 中已删除会话的孤儿 ID
        // （原实现残留，依赖重载后的 persist migrate 才自愈）
        pinnedSessionIds: get().pinnedSessionIds.filter(
          (pid) => nonChatSessions[pid],
        ),
      });
    } catch (error) {
      const { handleClientError } = await import("@/utils/handleError");
      handleClientError(
        error,
        { module: "stores:sessionSlice", action: "clearAllChatSessions" },
        "warn",
      );
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
