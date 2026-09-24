import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentRuntimePanel } from "../components/views/agent-runtime/AgentRuntimePanel";

// 与既有 client 组件测试同一套 mock（`http` / `httpLegacy` 都指向同一 stub）
const mockGet = vi.fn();
vi.mock("../services/httpClient", () => ({
  http: { get: (...args: unknown[]) => mockGet(...args) },
  httpLegacy: { get: (...args: unknown[]) => mockGet(...args) },
}));

/** 一条运行台账行（字段与 `/v1/agents/runs` 响应一致） */
function run(overrides: Record<string, unknown> = {}) {
  return {
    toolCallId: "run-1",
    agentId: "run-1",
    name: "写周报",
    agentType: "architect",
    status: "failed",
    descriptorSource: "role-store",
    batchId: null,
    taskKey: null,
    startedAt: 1700000000000,
    endedAt: 1700000001000,
    error: "子代理执行未完成",
    attribution: null,
    ...overrides,
  };
}

function mockEndpoints(runs: unknown[]): void {
  mockGet.mockImplementation((url: string) =>
    Promise.resolve(
      url.startsWith("/v1/agents/control")
        ? { spawn: { paused: false }, agents: [] }
        : { total: runs.length, runs },
    ),
  );
}

describe("AgentRuntimePanel —— 失败归因渲染（接线期③ ③-A）", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("失败 run 带归因 ⇒ 渲染起点与候选（按 score 降序，两位小数）", async () => {
    mockEndpoints([
      run({
        attribution: {
          failedNodeId: "step:tu_2",
          candidates: [
            {
              nodeId: "step:tu_1",
              kind: "task",
              distance: 1,
              score: 1,
              pathEvidenceRefs: ["tool_use:tu_1"],
            },
            {
              nodeId: "architect",
              kind: "agent",
              distance: 3,
              score: 0.2,
              pathEvidenceRefs: [],
            },
          ],
        },
      }),
    ]);

    render(<AgentRuntimePanel isDark={false} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "归因（起点 step:tu_2）：step:tu_1(1.00) → architect(0.20)",
        ),
      ).toBeTruthy();
    });
  });

  it("完成态（无归因）⇒ 不渲染归因行", async () => {
    mockEndpoints([run({ status: "completed" })]);

    render(<AgentRuntimePanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("写周报")).toBeTruthy();
    });
    expect(screen.queryByText(/归因（起点/)).toBeNull();
  });

  it("有归因但候选为空 ⇒ 明示「无上游候选」（不编造结论）", async () => {
    mockEndpoints([
      run({ attribution: { failedNodeId: "run:run-1", candidates: [] } }),
    ]);

    render(<AgentRuntimePanel isDark={false} />);

    await waitFor(() => {
      expect(
        screen.getByText("归因（起点 run:run-1）：无上游候选"),
      ).toBeTruthy();
    });
  });

  it("多行 run：仅带归因的那行出现归因行", async () => {
    mockEndpoints([
      run({ toolCallId: "run-ok", name: "已完成的活", status: "completed" }),
      run({
        toolCallId: "run-bad",
        name: "失败的活",
        attribution: {
          failedNodeId: "run:run-bad",
          candidates: [
            {
              nodeId: "architect",
              kind: "agent",
              distance: 1,
              score: 0.2,
              pathEvidenceRefs: ["agent_run:run-bad"],
            },
          ],
        },
      }),
    ]);

    render(<AgentRuntimePanel isDark={false} />);

    await waitFor(() => {
      expect(
        screen.getByText("归因（起点 run:run-bad）：architect(0.20)"),
      ).toBeTruthy();
    });
    expect(screen.getAllByText(/归因（起点/)).toHaveLength(1);
  });
});
