/**
 * BUG-02（2026-10-22 前端巡检）：`/agent/advanced` 不得用**系统工作空间** id 查后端
 *
 * 缺陷现场：停留在 `/knowledge` 后进入 Agent 高级管理，页面用
 * `currentWorkspace.id`（"knowledge"，来自 `SYSTEM_WORKSPACES`）请求
 * `GET /v1/workspaces/knowledge/swarm` ⇒ 404 `Workspace not found`，
 * 且错误被 `.catch()` 吞掉，Swarm 面板静默空白。
 *
 * 本文件锁「接线」而非纯逻辑：
 *  ① 系统工作空间 ⇒ **不**发起 swarm 请求，并显示项目工作空间引导；
 *  ② 真实项目工作空间 ⇒ 正常以其 id 请求。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** 根 store 的最小状态（只被 `selectCurrentWorkspace` 读取） */
  state: {
    currentWorkspaceId: null as string | null,
    worktrees: {} as Record<string, Record<string, unknown>>,
  },
  getSwarmStatus: vi.fn(),
}));

vi.mock("../stores/root-store", () => ({
  useRootStore: (selector: (s: unknown) => unknown) => selector(h.state),
}));

vi.mock("../stores/configStore", () => ({
  useConfigStore: (selector: (s: unknown) => unknown) =>
    selector({ config: { theme: "light" } }),
}));

vi.mock("../services/workspaceService", () => ({
  workspaceService: { getSwarmStatus: h.getSwarmStatus },
}));

vi.mock("../services/configService", () => ({
  configService: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

// 子组件与本用例断言无关，替身掉以隔离渲染依赖
vi.mock("../components/Agent/AgentStrategySelector", () => ({
  default: () => null,
}));
vi.mock("../components/Agent/AgentSwarmView", () => ({
  default: () => null,
}));
vi.mock("../components/Agent/AgentIdentityConfig", () => ({
  default: () => null,
}));
vi.mock("../components/Workspace/AgentModelBindingConfig", () => ({
  default: () => null,
}));

import AgentAdvancedPage from "../components/views/AgentAdvancedPage";

function setWorkspace(
  id: string | null,
  worktrees: Record<string, Record<string, unknown>>,
) {
  h.state.currentWorkspaceId = id;
  h.state.worktrees = worktrees;
}

describe("BUG-02：Agent 高级管理的 Swarm 作用域", () => {
  beforeEach(() => {
    h.getSwarmStatus.mockReset();
    h.getSwarmStatus.mockResolvedValue({ agents: [] });
    setWorkspace(null, {});
  });

  afterEach(() => {
    cleanup();
  });

  it("系统工作空间（knowledge）⇒ 不请求 swarm，并显示项目工作空间引导", async () => {
    setWorkspace("knowledge", {
      knowledge: { id: "knowledge", workspaceSource: "system" },
    });

    render(<AgentAdvancedPage />);
    // 给 effect 一个 tick，确认「未发起请求」不是因尚未执行
    await Promise.resolve();

    expect(h.getSwarmStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Swarm编排"));
    expect(screen.getByText(/仅对项目工作空间生效/)).toBeTruthy();
  });

  it("真实项目工作空间 ⇒ 以其 id 请求 swarm 状态", async () => {
    setWorkspace("proj_178", {
      proj_178: { id: "proj_178", workspaceSource: "user" },
    });

    render(<AgentAdvancedPage />);

    await waitFor(() => {
      expect(h.getSwarmStatus).toHaveBeenCalledWith("proj_178");
    });
  });
});
