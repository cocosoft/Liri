/**
 * N-10（2026-11-06 真机长程任务）：`resolveWorkMode()` 的缺省必须是 `do`。
 *
 * 事故：缺省 `plan` + 输入区 Plan/Do 开关已于 2026-11-05 移除 ⇒ 新建会话的第一条消息
 * 必然带 `work_mode=plan`，模型按「只规划、不调用有副作用的写工具」行事
 * （实测 `session_mw4xn1o6cb5281eb70`：用户要求"完整开发一个游戏"，零交付）。
 *
 * 口径：普通会话（无显式 workMode）⇒ `do`；显式 `plan`（如工作空间会话）仍原样透传。
 */
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessions: [] as Array<{ id: string; workMode?: "plan" | "do" }>,
}));

vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({ sessions: state.sessions }),
  },
}));

import { resolveWorkMode } from "../chat-message-actions";

describe("resolveWorkMode 缺省口径（N-10）", () => {
  it("没有 sessionId ⇒ do（缺省不再把请求打成 plan）", async () => {
    expect(await resolveWorkMode()).toBe("do");
  });

  it("会话存在但没有任何 workMode ⇒ do", async () => {
    state.sessions = [{ id: "sess-new" }];
    expect(await resolveWorkMode("sess-new")).toBe("do");
  });

  it("会话显式 workMode=plan（工作空间会话）⇒ 原样保留 plan", async () => {
    state.sessions = [{ id: "sess-ws", workMode: "plan" }];
    expect(await resolveWorkMode("sess-ws")).toBe("plan");
  });

  it("会话显式 workMode=do ⇒ do", async () => {
    state.sessions = [{ id: "sess-do", workMode: "do" }];
    expect(await resolveWorkMode("sess-do")).toBe("do");
  });
});
