// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GoalBar 会话级「目标条」测试（X11 / V19，2026-10-05）
 *
 * Spec：`.trae/specs/goal-entity.md` §11.2（前端）+ §11.4 V19。
 * 锁死三件事：
 * 1. 无未终结目标 ⇒ 渲染"＋ 设目标"入口；
 * 2. 有未终结目标 ⇒ 渲染 objective + 状态；
 * 3. 创建成功后刷新列表（重新 `list`，不复用旧状态）。
 *
 * `goalService` 走**模块级 mock**（非假 HTTP）；文案走测试基座真实 zh 字典
 * （`createTestT`，缺键即抛错）⇒ `goalBar.*` 漏拷会在此暴露。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/goalService", () => ({
  goalService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

import GoalBar from "../components/ChatArea/GoalBar";
import { goalService } from "../services/goalService";
import type { TaskGoalDto } from "../types/events";

const mockList = vi.mocked(goalService.list);
const mockCreate = vi.mocked(goalService.create);

function makeGoal(overrides: Partial<TaskGoalDto> = {}): TaskGoalDto {
  return {
    id: "g1",
    sessionId: "s1",
    objective: "完成目标",
    status: "active",
    tokensUsed: 0,
    noProgressStreak: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("GoalBar 会话级目标条（X11 / V19）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无未终结目标 ⇒ 渲染'设目标'入口", async () => {
    mockList.mockResolvedValue([]);
    render(<GoalBar sessionId="s1" />);
    expect(
      await screen.findByRole("button", { name: /设目标/ }),
    ).toBeInTheDocument();
  });

  it("有未终结目标 ⇒ 渲染 objective 与状态（且不再显示'设目标'入口）", async () => {
    mockList.mockResolvedValue([
      makeGoal({ objective: "把 X 做到 Y", status: "active" }),
    ]);
    render(<GoalBar sessionId="s1" />);
    expect(await screen.findByText("把 X 做到 Y")).toBeInTheDocument();
    expect(screen.getByText(/进行中/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /设目标/ }),
    ).not.toBeInTheDocument();
  });

  it("创建成功 ⇒ 重新拉取列表并渲染新目标", async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce([]);
    mockList.mockResolvedValueOnce([
      makeGoal({ id: "g2", objective: "新建目标" }),
    ]);
    mockCreate.mockResolvedValue(makeGoal({ id: "g2", objective: "新建目标" }));

    render(<GoalBar sessionId="s1" />);
    await user.click(await screen.findByRole("button", { name: /设目标/ }));
    await user.type(screen.getByPlaceholderText(/描述/), "新建目标");
    await user.click(screen.getByRole("button", { name: /创建目标/ }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ objective: "新建目标", sessionId: "s1" }),
      );
    });
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("新建目标")).toBeInTheDocument();
  });
});
