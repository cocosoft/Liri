/**
 * 竞态条件回归测试
 *
 * 守护核心修复分支的日志埋点与竞态修复行为，防止回归：
 *  1. useChatDraft 切会话丢草稿竞态 → 验证 draft:flushOnSwitch 触发且草稿落盘
 *  2. GlobalSearchModal 请求序号竞态 → 验证 search:staleDrop 丢弃旧请求、新结果不被覆盖
 *  3. SessionListItem 双击抖动竞态 → 验证单击切换被取消（clickCancelledByDblClick）、
 *     单击正常切换（switch）
 *
 * 说明：日志事件经 console.info 输出（见 utils/logger.ts），通过 spy 断言。
 * 加入 CI：client-test job 执行 `bun run test`（vitest run），本文件自动纳入。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import GlobalSearchModal from "../components/ChatArea/GlobalSearchModal";
import SessionListItem from "../components/ChatArea/SessionListItem";

vi.mock("../services/fileService", () => ({
  fileService: { searchFiles: vi.fn() },
}));
vi.mock("../services/knowledgeService", () => ({
  knowledgeService: { search: vi.fn() },
}));
import { fileService } from "../services/fileService";
import { knowledgeService } from "../services/knowledgeService";
import { useChatDraft } from "../components/ChatArea/useChatDraft";

// ── useChatDraft 测试 Harness ─────────────────────────────
function DraftHarness({ sid }: { sid?: string }) {
  // P0-4：setInputWithDraft 已删除，setInput 内部统一走持久化
  const { input, setInput } = useChatDraft(sid);
  return (
    <input
      aria-label="draft-input"
      value={input}
      onChange={(e) => setInput(e.target.value)}
    />
  );
}

// ── SessionListItem 最小 props ────────────────────────────
const noop = () => undefined;
const sessionProps = {
  session: {
    id: "sess-1",
    title: "测试会话",
    updatedAt: new Date().toISOString(),
    messageCount: 0,
  },
  isActive: false,
  isEditing: false,
  editTitle: "",
  pinned: false,
  isDreamProcessed: false,
  getSourceLabel: () => "",
  onEditTitleChange: noop,
  onEditBlur: noop,
  onEditKeyDown: noop,
  onDelete: noop,
  onContextMenu: noop,
};

describe("竞态条件回归测试", () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("useChatDraft：300ms 内切会话 → draft:flushOnSwitch 触发且草稿落盘", async () => {
    const { rerender } = render(<DraftHarness sid="A" />);

    // 输入草稿（调度 300ms 防抖）
    fireEvent.change(screen.getByLabelText("draft-input"), {
      target: { value: "草稿A-未落盘" },
    });

    // 200ms 时切换会话（timer 尚未触发 → 竞态窗口）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    rerender(<DraftHarness sid="B" />);

    // ① 草稿已同步落盘到旧会话 key（R2 修复生效；W4 统一 liri- 命名空间）
    expect(localStorage.getItem("liri-chat-draft-A")).toBe("草稿A-未落盘");
    // ② 日志触发（flushOnSwitch 埋点生效）
    const flushLog = consoleInfoSpy.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("draft:flushOnSwitch"),
    );
    expect(flushLog).toBeTruthy();
    expect(flushLog![2]).toMatchObject({
      sessionId: "A",
      pendingLength: "草稿A-未落盘".length,
      action: "set",
    });
    // ③ 恢复点日志也存在
    const restoreLog = consoleInfoSpy.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("draft:restore"),
    );
    expect(restoreLog).toBeTruthy();
  });

  it("GlobalSearchModal：旧请求晚返回 → search:staleDrop 触发，新结果不被覆盖", async () => {
    // 每次调用 push 一个 resolve（不能只存单个——第二次调用会覆盖第一个的 resolve）
    const resolvers: Array<(v: { items: unknown[] }) => void> = [];
    const fileSearchMock = fileService.searchFiles as ReturnType<typeof vi.fn>;
    fileSearchMock.mockImplementation(
      () =>
        new Promise<{ items: unknown[] }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const knowledgeMock = knowledgeService.search as ReturnType<typeof vi.fn>;
    knowledgeMock.mockResolvedValue([]);

    render(<GlobalSearchModal isOpen onClose={() => undefined} />);
    const input = screen.getByRole("textbox");

    // 第一次输入 "ab" → 300ms 防抖后 seq=1 发起（文件搜索挂起）
    fireEvent.change(input, { target: { value: "ab" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fileSearchMock).toHaveBeenCalledTimes(1);

    // 第二次输入 "abc" → 300ms 后 seq=2 发起（新请求）
    fireEvent.change(input, { target: { value: "abc" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fileSearchMock).toHaveBeenCalledTimes(2);

    // 旧请求（seq=1，resolvers[0]）此刻才返回 → 应被序号机制丢弃并打 staleDrop 日志
    await act(async () => {
      resolvers[0]({ items: [{ fileId: "stale", originalName: "旧结果" }] });
    });

    const staleLog = consoleInfoSpy.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("search:staleDrop"),
    );
    expect(staleLog).toBeTruthy();
    expect(staleLog![2]).toMatchObject({ stage: "files" });

    // 新请求完成 → search:complete 日志（start/complete 成对）
    await act(async () => {
      resolvers[1]({ items: [] });
    });
    const completeLog = consoleInfoSpy.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("search:complete"),
    );
    expect(completeLog).toBeTruthy();
    // 注：seq 不硬编码——初始空 query 的 effect 也会使序号 +1，序号随运行次数递增
    expect(completeLog![2]).toMatchObject({ query: "abc" });
  });

  it("SessionListItem：双击 → clickCancelledByDblClick 触发且不切换", async () => {
    const onSwitch = vi.fn();
    const onDoubleClick = vi.fn();
    render(
      <SessionListItem
        {...sessionProps}
        onSwitch={onSwitch}
        onDoubleClick={onDoubleClick}
      />,
    );

    const btn = screen.getByRole("button", { name: /测试会话/ });

    // 双击 = 两次 click + 一次 dblclick（真实浏览器时序）
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.dblClick(btn);

    // 250ms 后：单击切换被取消 → onSwitch 不应被调用
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onSwitch).not.toHaveBeenCalled();
    expect(onDoubleClick).toHaveBeenCalledTimes(1);

    // 取消日志触发
    const cancelLog = consoleInfoSpy.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("sessionListItem:clickCancelledByDblClick"),
    );
    expect(cancelLog).toBeTruthy();
    expect(cancelLog![2]).toMatchObject({ sessionId: "sess-1" });
  });

  it("SessionListItem：单击 → switch 日志触发且切换执行", async () => {
    const onSwitch = vi.fn();
    const onDoubleClick = vi.fn();
    render(
      <SessionListItem
        {...sessionProps}
        onSwitch={onSwitch}
        onDoubleClick={onDoubleClick}
      />,
    );

    const btn = screen.getByRole("button", { name: /测试会话/ });
    fireEvent.click(btn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onSwitch).toHaveBeenCalledWith("sess-1");
    const switchLog = consoleInfoSpy.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("sessionListItem:switch"),
    );
    expect(switchLog).toBeTruthy();
    expect(switchLog![2]).toMatchObject({ sessionId: "sess-1" });
  });
});
