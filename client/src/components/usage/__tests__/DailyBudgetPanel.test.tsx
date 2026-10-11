/**
 * T7（Spec `daily-budget-over-limit-ux.md` §5-E / §4 D-b/D-h）：
 * 前端「限额」配置面 —— **放行能力**（提额 / 当日解除）、**欠账与生效放行展示**、
 * 以及后端广播 `cost:dailyBudgetUpdated` 驱动的**即时刷新**。
 *
 * 契约：
 * - 只读展示补 **欠账** 与 **当前生效的放行**（kind + 到期时间）—— 后端 T5 已返回该两字段；
 * - 现场提交**临时提额 / 当日解除** ⇒ `usageService.setDailyBudgetRelief`（D-b）；
 * - 订阅 `cost:dailyBudgetUpdated` ⇒ 面板即时刷新（**不依赖 30s 轮询**）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DailyBudgetPanel from "../DailyBudgetPanel";
import { sseService } from "../../../services/sseService";

const mocks = vi.hoisted(() => ({
  getDailyBudget: vi.fn(),
  setDailyBudgetRelief: vi.fn(),
  configGet: vi.fn(),
  configSet: vi.fn(),
}));

vi.mock("../../../services/usageService", () => ({
  usageService: {
    getDailyBudget: mocks.getDailyBudget,
    setDailyBudgetRelief: mocks.setDailyBudgetRelief,
    updateDailyBudget: vi.fn(),
    resetDailyBudget: vi.fn(),
    setDailyBudgetKillSwitch: vi.fn(),
  },
}));

vi.mock("../../../services/configService", () => ({
  configService: { get: mocks.configGet, set: mocks.configSet },
}));

/** 后端广播事件名（`daily-budget-handlers.ts` 的 `DAILY_BUDGET_SSE_EVENT`） */
const SSE_EVENT = "cost:dailyBudgetUpdated";

/** 模拟后端广播（`dispatch` 为 sseService 的私有分发入口） */
function emitBudgetUpdated(payload: Record<string, unknown> = {}): void {
  const svc = sseService as unknown as {
    dispatch: (event: string, data: Record<string, unknown>) => void;
  };
  svc.dispatch(SSE_EVENT, payload);
}

/** 日限额状态夹具（对齐 `GET /v1/cost/daily-budget`，含 T5 新增的 relief / debt） */
function budgetStatus(over: Record<string, unknown> = {}) {
  return {
    date: "2026-10-11",
    mode: "locked",
    todayUsed: 901_200,
    projectedUsed: 901_200,
    dailyLimit: 500_000,
    percentUsed: 1.8,
    remaining: 0,
    warningThreshold: 0.8,
    lockThreshold: 1,
    killSwitch: false,
    debt: 12_345,
    relief: {
      kind: "boost",
      expiresAt: Date.now() + 60 * 60_000,
      effectiveLimit: 1_000_000,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 未保存过放行默认值 ⇒ 面板沿用 D-n / D-b 的默认（×2 / 1 小时 / 需二次确认）
  mocks.configGet.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DailyBudgetPanel：欠账与生效放行展示（D-d / D-b，只读）", () => {
  it("展示欠账与当前放行（kind + 到期时间）", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus());
    render(<DailyBudgetPanel />);

    expect(await screen.findByText("透支欠账")).toBeTruthy();
    expect(screen.getByText("12,345")).toBeTruthy();
    expect(screen.getByText("当前放行")).toBeTruthy();

    const reliefCell = screen.getByText(/临时提额/);
    expect(reliefCell.textContent).toContain("到期");
    expect(reliefCell.textContent).not.toContain("至今日结束");
  });

  it("`unlock-today`（expiresAt = null）⇒ 到期展示为「至今日结束」", async () => {
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({
        relief: {
          kind: "unlock-today",
          expiresAt: null,
          effectiveLimit: 2_500_000,
        },
      }),
    );
    render(<DailyBudgetPanel />);

    const reliefCell = await screen.findByText(/今日解除/);
    expect(reliefCell.textContent).toContain("至今日结束");
  });
});

describe("DailyBudgetPanel：现场放行（D-b）", () => {
  it("提交临时提额 ⇒ 调 setDailyBudgetRelief({kind:'boost'})，且尊重二次确认", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus());
    mocks.setDailyBudgetRelief.mockResolvedValue(budgetStatus());
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);

    render(<DailyBudgetPanel />);
    await screen.findByText("急救放行");

    fireEvent.click(screen.getByText("立即提额"));

    await waitFor(() =>
      expect(mocks.setDailyBudgetRelief).toHaveBeenCalledTimes(1),
    );
    expect(mocks.setDailyBudgetRelief).toHaveBeenCalledWith({
      kind: "boost",
      factor: 2,
      ttlMs: 60 * 60_000,
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it("二次确认被拒 ⇒ **不**发起放行请求", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus());
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );

    render(<DailyBudgetPanel />);
    await screen.findByText("今日不再拦截");

    fireEvent.click(screen.getByText("今日不再拦截"));

    expect(mocks.setDailyBudgetRelief).not.toHaveBeenCalled();
  });
});

describe("DailyBudgetPanel：即时刷新（D-h）", () => {
  it("订阅 cost:dailyBudgetUpdated ⇒ 收到事件即刷新，不依赖 30s 轮询", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus());
    const { unmount } = render(<DailyBudgetPanel />);
    expect(await screen.findByText("901,200")).toBeTruthy();

    // 后端侧变更（另开窗口提额 / 用量增长）⇒ 广播 ⇒ 面板重取。
    // 注意：本用例**未推进任何定时器** ⇒ 内容能变即证明刷新由 SSE 驱动，而非 30s 轮询。
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({ todayUsed: 999_999 }),
    );
    emitBudgetUpdated({ mode: "locked" });

    expect(await screen.findByText("999,999")).toBeTruthy();

    // 订阅随组件生命周期回收：卸载后不再响应广播
    unmount();
    const settled = mocks.getDailyBudget.mock.calls.length;
    emitBudgetUpdated();
    expect(mocks.getDailyBudget.mock.calls.length).toBe(settled);
  });
});
