/**
 * sessionSlice 竞态守卫回归测试（P0-1）
 *
 * sessionSlice 累计 10+ 处竞态守卫（_switchSeq、N1-N8、E1、G1/G2、R2 等），
 * 逻辑精密但此前零测试覆盖。本文件覆盖核心场景，防止重构静默破坏守卫：
 *  1. 404 降级（N1）：目标会话不存在 → 清理残留 + 切到最近会话
 *  2. R2 回退加载打断：getOrCreateSession 回退加载期间新切换 → 放弃 loadMessages
 *  3. 普通切换基线（防守卫误杀）
 *  4. 乱序切换（P1-2，放最后）：先发起的慢切换后完成 → 被丢弃
 *
 * Mock 策略：sessionSlice 对 sessionService 采用动态 import（`await import(...)`），
 * Vitest 对"动态 import + vi.mock 模块"的命中存在竞态（实测不稳定）。因此不 mock
 * sessionService 模块本身，改为 mock 其静态依赖 httpClient——无论动态 import 加载
 * 真实还是 mock 的 sessionService，行为都收敛到可控的 HTTP 响应，且真实模块的
 * N1 404 抛错路径（statusCode 404）被真实执行，覆盖更真实。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "zustand";
import type { SessionSlice } from "../stores/root-store/sessionSlice";
import { createSessionSlice } from "../stores/root-store/sessionSlice";

// ─── Mock 动态依赖 ───────────────────────────────────────
// httpClient：sessionService 的静态依赖（始终被拦截），控制所有 HTTP 行为
vi.mock("../services/httpClient", () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    stream: vi.fn(),
  },
}));
vi.mock("../stores/chat", () => ({
  // N-56：switchChatSession 现在会调 store 的 setHasOlder（分页完整性标记），
  // 替身需同步补齐，否则切换流程在该调用处抛错中断（loadMessages 不再执行）。
  useChatStore: {
    getState: () => ({
      messages: [],
      setHasOlder: vi.fn(),
      setOldestSeq: vi.fn(),
    }),
  },
  _getCachedMessages: vi.fn(),
}));
vi.mock("../stores/chat/chatCoordinator", () => ({
  chatCoordinator: {
    stopMessage: vi.fn(),
    stopAndFlush: vi.fn().mockResolvedValue([]),
    abortPausedStream: vi.fn().mockResolvedValue(undefined),
    loadMessages: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../utils/handleError", () => ({
  handleClientError: vi.fn(),
}));
vi.mock("../services/modelSwitchService", () => ({
  modelSwitchService: {
    getCurrent: vi.fn(),
    getTasks: vi.fn(),
    switch: vi.fn(),
  },
}));
vi.mock("../stores/modelSwitchStore", () => ({
  useModelSwitchStore: {
    getState: () => ({
      // 必须返回 Promise——switchChatSession 里 `loadCurrent().catch()` 调用
      loadCurrent: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { http } from "../services/httpClient";
import { chatCoordinator } from "../stores/chat/chatCoordinator";
import { _getCachedMessages } from "../stores/chat";
import { handleClientError } from "../utils/handleError";

const mockHttp = vi.mocked(http);
const mockCoordinator = vi.mocked(chatCoordinator);
const mockGetCached = vi.mocked(_getCachedMessages);

// ─── 最小 SessionSlice store（单例；竞态守卫模块级变量共享）──────────
const useTestStore = create<SessionSlice>()((set, get, api) =>
  createSessionSlice(set as never, get as never, api as never),
);

function makeSession(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `会话${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    roundCount: 0,
    workspaceId: undefined,
    modelId: undefined,
    ...extra,
  };
}

/** 手动可控 Promise */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("sessionSlice 竞态守卫（P0-1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockReturnValue(null); // 缓存 miss，走网络 getMessages
    // 默认 HTTP 响应：成功空消息 / 默认会话（每个测试再按 URL 覆盖）
    mockHttp.get.mockResolvedValue({ ok: true, data: [] });
    mockHttp.post.mockResolvedValue({ ok: true, data: makeSession("default") });
    useTestStore.setState({
      sessions: {},
      currentSessionId: null,
      chatSessions: [],
      switching: false,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("404 降级：目标会话不存在 → 清理残留并切到最近会话（N1）", async () => {
    // 真实 sessionService.switch 对 404 抛出 statusCode=404 错误
    mockHttp.post.mockImplementation((url: string) => {
      if (url.includes("/sess-ghost/switch"))
        return Promise.resolve({
          ok: false,
          error: { code: 404, message: "会话不存在" },
        });
      if (url.includes("/sess-next/switch"))
        return Promise.resolve({ ok: true, data: makeSession("sess-next") });
      return Promise.resolve({ ok: true, data: makeSession("default") });
    });
    useTestStore.setState({
      chatSessions: [makeSession("sess-next"), makeSession("sess-ghost")],
      sessions: {
        "sess-ghost": {
          id: "sess-ghost",
          moduleType: "chat",
          workspaceId: "",
          title: "幽灵",
          createdAt: 1,
          updatedAt: 2,
          context: { moduleType: "chat" },
        },
      },
      currentSessionId: "sess-ghost",
    });

    await useTestStore.getState().switchChatSession("sess-ghost");

    // 目标从列表移除，切到最近会话
    const state = useTestStore.getState();
    expect(state.chatSessions.some((s) => s.id === "sess-ghost")).toBe(false);
    expect(state.currentSessionId).toBe("sess-next");
    // 幽灵记录从 Hub 移除
    expect(state.sessions["sess-ghost"]).toBeUndefined();
    // 错误被清空（404 是业务路径，非错误态）
    expect(state.error).toBeNull();
  });

  it("R2 回退加载：getOrCreateSession 回退加载期间发生新切换 → 放弃 loadMessages", async () => {
    const getMessagesDeferred = deferred<{
      ok: boolean;
      data: ReturnType<typeof makeSession>[];
    }>();
    // IIFE 的 getMessages(sess-chatA) 挂起（deferred），switchChatSession 的
    // getMessages(sess-chatB) 立即返回空
    mockHttp.get.mockImplementation((url: string) => {
      if (url.includes("/sess-chatA/messages"))
        return getMessagesDeferred.promise;
      return Promise.resolve({ ok: true, data: [] });
    });
    mockHttp.post.mockImplementation((url: string) => {
      if (url.includes("/sess-chatA/switch"))
        return Promise.resolve({ ok: true, data: makeSession("sess-chatA") });
      if (url.includes("/sess-chatB/switch"))
        return Promise.resolve({ ok: true, data: makeSession("sess-chatB") });
      return Promise.resolve({ ok: true, data: makeSession("default") });
    });
    const chatA = makeSession("sess-chatA");
    useTestStore.setState({
      chatSessions: [chatA, makeSession("sess-chatB")],
      sessions: {
        "sess-chatB": {
          id: "sess-chatB",
          moduleType: "chat",
          workspaceId: "",
          title: "B",
          createdAt: 1,
          updatedAt: 2,
          context: { moduleType: "chat" },
        },
      },
      // 当前会话是项目会话（非 chat）→ 触发回退分支
      currentSessionId: "sess-proj",
    });

    // 回退加载（IIFE 挂起在 getMessages）
    const fallbackId = useTestStore.getState().getOrCreateSession("chat");
    expect(fallbackId).toBe("sess-chatA");

    // 加载期间用户点侧栏切到 B（_switchSeq++）
    await useTestStore.getState().switchChatSession("sess-chatB");

    // 回退的 getMessages 此时才完成 → R2 守卫应放弃 loadMessages(chatA)
    getMessagesDeferred.resolve({ ok: true, data: [] });
    await Promise.resolve();
    await Promise.resolve();

    // loadMessages 只被 switchChatSession(B) 调用一次（chatA 回退被 R2 守卫放弃）
    expect(mockCoordinator.loadMessages).toHaveBeenCalledTimes(1);
    expect(useTestStore.getState().currentSessionId).toBe("sess-chatB");
  });

  it("普通切换：单次切换正常完成（基线，防守卫误杀）", async () => {
    mockHttp.post.mockImplementation((url: string) => {
      if (url.includes("/sess-A/switch"))
        return Promise.resolve({ ok: true, data: makeSession("sess-A") });
      return Promise.resolve({ ok: true, data: makeSession("default") });
    });
    mockHttp.get.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "m1",
          role: "user",
          content: "hi",
          timestamp: 1,
          session_id: "sess-A",
        },
      ],
    });
    useTestStore.setState({
      chatSessions: [makeSession("sess-A")],
      currentSessionId: null,
    });

    await useTestStore.getState().switchChatSession("sess-A");

    expect(useTestStore.getState().currentSessionId).toBe("sess-A");
    expect(mockCoordinator.loadMessages).toHaveBeenCalledTimes(1);
    expect(mockCoordinator.loadMessages).toHaveBeenCalledWith([
      expect.objectContaining({ id: "m1" }),
    ]);
  });

  it("乱序切换：先发起的慢切换后完成 → 被丢弃，currentSessionId 保持最新（P1-2）", async () => {
    const switchA = deferred<{
      ok: boolean;
      data: ReturnType<typeof makeSession>;
    }>();
    const switchB = deferred<{
      ok: boolean;
      data: ReturnType<typeof makeSession>;
    }>();
    mockHttp.post.mockImplementation((url: string) => {
      if (url.includes("/sess-A/switch")) return switchA.promise;
      if (url.includes("/sess-B/switch")) return switchB.promise;
      return Promise.resolve({ ok: true, data: makeSession("default") });
    });
    useTestStore.setState({
      chatSessions: [makeSession("sess-A"), makeSession("sess-B")],
      currentSessionId: null,
    });

    // 先发起 A（挂起），再发起 B（挂起）——模拟快速连点
    const pA = useTestStore.getState().switchChatSession("sess-A");
    const pB = useTestStore.getState().switchChatSession("sess-B");

    // B 先完成（最新目标）
    switchB.resolve({ ok: true, data: makeSession("sess-B") });
    await pB;
    // A 后完成（过期，应被 _switchSeq 丢弃）
    switchA.resolve({ ok: true, data: makeSession("sess-A") });
    await pA;

    expect(useTestStore.getState().currentSessionId).toBe("sess-B");
    // 确保 handleClientError 未被当作普通错误调用（被丢弃是正常路径）
    expect(handleClientError).not.toHaveBeenCalled();
  });
});

describe("P0 前端四项（F-01/F-04/F-05）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockReturnValue(null);
    mockHttp.get.mockResolvedValue({ ok: true, data: [] });
    mockHttp.post.mockResolvedValue({ ok: true, data: makeSession("default") });
    useTestStore.setState({
      sessions: {},
      currentSessionId: null,
      chatSessions: [],
      switching: false,
      isLoading: false,
      error: null,
    });
  });

  it("F-01：list() 后端全失败时上抛，loadChatSessions 保留现有会话而非误清空", async () => {
    // 现有已加载的会话（模拟正常状态下已有列表）
    useTestStore.setState({
      chatSessions: [makeSession("sess-A")],
      currentSessionId: "sess-A",
    });
    // HTTP 失败（后端不可用），且无 Tauri 降级（getTauriCore 返回 null）→ list() 抛错
    mockHttp.get.mockRejectedValue(new Error("network down"));

    await useTestStore.getState().loadChatSessions();

    // 关键断言：list() 失败不再被当作"权威空列表"，现有会话与当前会话均保留
    const state = useTestStore.getState();
    expect(state.chatSessions.map((s) => s.id)).toContain("sess-A");
    expect(state.currentSessionId).toBe("sess-A");
  });

  it("F-04：补拉 loadConversation 期间发生切换 → 放弃补拉的 loadMessages（不跨会话覆盖）", async () => {
    // loadConversation(A) 挂起（deferred），模拟 补拉 慢返回
    const loadConvA = deferred<{
      ok: boolean;
      data: ReturnType<typeof makeSession>[];
    }>();
    mockHttp.get.mockImplementation((url: string) => {
      if (url.includes("/sessions/current"))
        return Promise.resolve({ ok: true, data: makeSession("sess-A") });
      if (url.endsWith("/v1/sessions"))
        return Promise.resolve({
          ok: true,
          data: [makeSession("sess-A"), makeSession("sess-B")],
        });
      if (url.includes("/sess-A/messages")) return loadConvA.promise;
      // latch 非消息路径（如列表）默认空
      return Promise.resolve({ ok: true, data: [] });
    });
    mockHttp.post.mockImplementation((url: string) => {
      if (url.includes("/sess-A/switch"))
        return Promise.resolve({ ok: true, data: makeSession("sess-A") });
      if (url.includes("/sess-B/switch"))
        return Promise.resolve({ ok: true, data: makeSession("sess-B") });
      return Promise.resolve({ ok: true, data: makeSession("default") });
    });
    // 预置 A、B 两个会话；当前无消息 → 触发补拉
    useTestStore.setState({
      chatSessions: [makeSession("sess-A"), makeSession("sess-B")],
      currentSessionId: "sess-A",
    });

    // loadChatSessions：进入补拉 path，loadConversation(A) 挂起
    const loadPromise = useTestStore.getState().loadChatSessions();
    await loadConvA; // 等第一次 await 命中（不 resolve，仅建立 pending）

    // 补拉挂起期间，用户切到 B（_switchSeq++）
    await useTestStore.getState().switchChatSession("sess-B");

    // 补拉此刻才返回
    loadConvA.resolve({ ok: true, data: [] });
    await loadPromise;

    // F-04 守卫：补拉 loadMessages 被放弃，只有 switchChatSession(B) 的 loadMessages 调用一次
    expect(mockCoordinator.loadMessages).toHaveBeenCalledTimes(1);
    expect(useTestStore.getState().currentSessionId).toBe("sess-B");
  });

  it("F-05：createChatSession 失败后 _pendingCreate 被清理，且不产生额外 unhandled rejection", async () => {
    // assert 复用后并发调用返回同一 Promise
    // create 失败（http.post reject）
    mockHttp.post.mockRejectedValue(new Error("create failed"));
    // moduleContext 为 chat，避免走 project workspace 分支
    useTestStore.setState({ currentSessionId: null, chatSessions: [] });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    const p1 = useTestStore.getState().createChatSession("新会话");
    // 第二次调用应复用同一 Promise（G2）
    const p2 = useTestStore.getState().createChatSession("新会话");
    expect(p1).toBe(p2);

    await expect(p1).rejects.toBeTruthy();

    // 清理监听后微任务再 flush，确认后处理
    process.off("unhandledRejection", onUnhandled);
    await new Promise((r) => setImmediate(r));

    // F-05 核心：_pendingCreate 已重置（finally.catch 吞掉派生 rejection，无额外未处理拒绝）
    expect(unhandled.length).toBe(0);
    // 再次创建返回新 Promise（非复用的旧失败 Promise）
    const p3 = useTestStore.getState().createChatSession("新会话2");
    expect(p3).not.toBe(p1);
  });

  it("togglePin 失败时上抛且不回写错误 pinned 状态", async () => {
    useTestStore.setState({
      chatSessions: [
        { ...makeSession("sess-A"), pinned: false },
        makeSession("sess-B"),
      ],
    });
    // setPinned 失败（http.patch 抛错）
    mockHttp.patch.mockRejectedValue(new Error("后端不可用"));

    await expect(
      useTestStore.getState().togglePin("sess-A"),
    ).rejects.toThrow("后端不可用");

    // 状态未被回写（pinned 仍为 false，未误标 true）
    const sA = useTestStore
      .getState()
      .chatSessions.find((s) => s.id === "sess-A");
    expect(sA?.pinned).toBe(false);
  });
});

describe("project 判定收敛（阶段一 4.2.1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockReturnValue(null); // 缓存 miss
    mockHttp.get.mockResolvedValue({ ok: true, data: [] });
    mockHttp.post.mockResolvedValue({ ok: true, data: makeSession("default") });
    useTestStore.setState({
      sessions: {},
      currentSessionId: null,
      chatSessions: [],
      switching: false,
      isLoading: false,
      error: null,
    });
  });

  it("legacy project 会话（无 metadata.moduleType/projectId，workspaceId=project-*）→ moduleType=project + projectId 兜底", async () => {
    mockHttp.get.mockImplementation((url: string) => {
      if (url.includes("/sessions/current"))
        return Promise.resolve({ ok: true, data: null });
      return Promise.resolve({
        ok: true,
        data: [
          {
            ...makeSession("sess-legacy"),
            workspaceId: "project-oldid",
            metadata: { title: "对话 1", workspaceId: "project-oldid" },
          },
        ],
      });
    });

    await useTestStore.getState().loadChatSessions();

    const hub = useTestStore.getState().sessions["sess-legacy"];
    expect(hub?.moduleType).toBe("project");
    expect(hub?.projectId).toBe("project-oldid");
    expect(hub?.workspaceId).toBe("project-oldid");
  });

  it("chat 会话（无 workspaceId）→ moduleType=chat、projectId 缺省", async () => {
    mockHttp.get.mockImplementation((url: string) => {
      if (url.includes("/sessions/current"))
        return Promise.resolve({ ok: true, data: null });
      return Promise.resolve({ ok: true, data: [makeSession("sess-chat")] });
    });

    await useTestStore.getState().loadChatSessions();

    const hub = useTestStore.getState().sessions["sess-chat"];
    expect(hub?.moduleType).toBe("chat");
    expect(hub?.projectId).toBeUndefined();
    expect(hub?.workspaceId).toBe("");
  });

  it("新 project 会话（metadata 齐全）→ 以 metadata 为事实面", async () => {
    mockHttp.get.mockImplementation((url: string) => {
      if (url.includes("/sessions/current"))
        return Promise.resolve({ ok: true, data: null });
      return Promise.resolve({
        ok: true,
        data: [
          {
            ...makeSession("sess-proj"),
            workspaceId: "proj_1786517089415_ksbi6c",
            metadata: {
              workspaceId: "proj_1786517089415_ksbi6c",
              moduleType: "project",
              projectId: "proj_1786517089415_ksbi6c",
            },
          },
        ],
      });
    });

    await useTestStore.getState().loadChatSessions();

    const hub = useTestStore.getState().sessions["sess-proj"];
    expect(hub?.moduleType).toBe("project");
    expect(hub?.projectId).toBe("proj_1786517089415_ksbi6c");
    expect(hub?.workspaceId).toBe("proj_1786517089415_ksbi6c");
  });
});
