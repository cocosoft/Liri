/**
 * 会话级导出（右上角）回归锁（2026-10-25）
 *
 * 缺陷现场：菜单可点、导出逻辑也执行（实测发出 `GET /v1/sessions/<id>/messages`），但**没有文件**、
 * 无任何报错。根因是下载发生在 `await` 之后（先取持久层消息、再分批让出主线程），已脱离
 * **用户手势**，浏览器会静默丢弃 `<a download>`；同一条气泡导出因全程同步而正常。
 *
 * 本文件锁三件事：
 *  ① 打开菜单即**预取**持久层消息（下载前完成所有 await）；
 *  ② 构建完成前菜单项禁用（不允许用半成品导出）；
 *  ③ 点击格式后 `triggerBlobDownload` 在**同一个点击任务内同步**被调用（无 await 间隔）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  triggerBlobDownload: vi.fn(),
  exportMessageAsFormat: vi.fn(),
  handleClientError: vi.fn(),
  getMessages: vi.fn(),
  messages: [] as Array<Record<string, unknown>>,
  session: { id: "s-1", title: "测试会话" } as Record<string, unknown> | null,
}));

vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: () => ({
    currentSession: mocks.session,
    renameSession: vi.fn(),
  }),
}));

vi.mock("@/stores/chat", () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ messages: mocks.messages }),
}));

vi.mock("@/services/sessionService", () => ({
  sessionService: { getMessages: mocks.getMessages },
}));

vi.mock("@/utils/exportMessage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/exportMessage")>();
  return {
    ...actual,
    triggerBlobDownload: mocks.triggerBlobDownload,
    exportMessageAsFormat: mocks.exportMessageAsFormat,
  };
});

vi.mock("@/utils/handleError", () => ({
  handleClientError: mocks.handleClientError,
}));

// 导出正文只关心"取到了内容"，正文渲染细节另有测试 ⇒ 此处收敛为 content
vi.mock("@/utils/messageText", () => ({
  getMessageSearchText: (msg: { content?: unknown }) =>
    String(msg.content ?? ""),
}));
vi.mock("@/utils/toolResultText", () => ({
  decodeToolResultContent: (content: string) => content,
}));

// 组件外壳（Tooltip / 标题）与导出无关，避免拉入完整 UI 依赖
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ render }: { render?: React.ReactNode }) => render ?? null,
  TooltipContent: () => null,
}));
vi.mock("@/components/ChatArea/SessionTitle", () => ({
  default: ({ text }: { text: string }) => <span>{text}</span>,
}));

import SessionHeader from "@/components/ChatArea/SessionHeader";

beforeEach(() => {
  mocks.messages = [
    { id: "m-1", role: "user", content: "你好", timestamp: Date.now() },
    {
      id: "m-2",
      role: "assistant",
      content: "你好，有什么可以帮你？",
      timestamp: Date.now(),
    },
  ];
  mocks.session = { id: "s-1", title: "测试会话" };
  mocks.getMessages.mockResolvedValue(mocks.messages);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("会话级导出：下载必须在点击任务内同步触发", () => {
  it("打开菜单即预取；就绪前菜单项禁用；点击后同步触发下载", async () => {
    render(<SessionHeader />);

    // 打开菜单（图标按钮的 title 即「导出会话」）
    fireEvent.click(screen.getByTitle("导出会话"));

    // ① 预取已发生（异步都发生在下载之前）
    expect(mocks.getMessages).toHaveBeenCalledWith("s-1");

    const mdItem = screen.getByText("导出为 Markdown").closest("button")!;
    // ② 构建完成前禁用（尚未就绪不给出半成品）
    expect(mdItem.disabled).toBe(true);

    await waitFor(() => expect(mdItem.disabled).toBe(false));

    // ③ 点击后**同步**下载：fireEvent 返回时已调用，无需 await
    fireEvent.click(mdItem);
    expect(mocks.triggerBlobDownload).toHaveBeenCalledTimes(1);

    const [blob, filename] = mocks.triggerBlobDownload.mock.calls[0] as [
      Blob,
      string,
    ];
    expect(blob.size).toBeGreaterThan(0);
    expect(filename).toMatch(/^chat-export-\d+\.md$/);
  });

  it("空会话：按钮禁用且提示「暂无消息可导出」（不产出空文件）", () => {
    mocks.messages = [];
    render(<SessionHeader />);

    const button = screen.getByTitle("当前会话暂无消息可导出");
    expect(button.hasAttribute("disabled")).toBe(true);

    fireEvent.click(button);
    expect(mocks.getMessages).not.toHaveBeenCalled();
    expect(mocks.triggerBlobDownload).not.toHaveBeenCalled();
  });
});
