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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DailyBudgetPanel from "../DailyBudgetPanel";
import { useModelSwitchStore } from "../../../stores/modelSwitchStore";
import { sseService } from "../../../services/sseService";

const mocks = vi.hoisted(() => ({
  getDailyBudget: vi.fn(),
  setDailyBudgetRelief: vi.fn(),
  clearDailyBudgetRelief: vi.fn(),
  updateDailyBudget: vi.fn(),
  estimateTurnCost: vi.fn(),
  configGet: vi.fn(),
  configSet: vi.fn(),
}));

vi.mock("../../../services/usageService", () => ({
  usageService: {
    getDailyBudget: mocks.getDailyBudget,
    setDailyBudgetRelief: mocks.setDailyBudgetRelief,
    clearDailyBudgetRelief: mocks.clearDailyBudgetRelief,
    updateDailyBudget: mocks.updateDailyBudget,
    estimateTurnCost: mocks.estimateTurnCost,
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
  const base = {
    date: "2026-10-11",
    mode: "locked",
    // 债四 S3（2026-10-15）：主口径三字段。本夹具为 **Token 主口径**
    // （`unit: "tokens"`）⇒ `used` ≡ `todayUsed`、`tokenLimit` ≡ `dailyLimit`。
    unit: "tokens",
    used: 901_200,
    tokenLimit: 500_000,
    todayUsed: 901_200,
    projectedUsed: 901_200,
    dailyLimit: 500_000,
    percentUsed: 1.8,
    remaining: 0,
    warningThreshold: 0.8,
    lockThreshold: 1,
    killSwitch: false,
    debt: 12_345,
    // 债四 USD-3：金额口径三字段（默认**未配置** ⇒ `limitUsd: null`，不臆造 0）
    usedUsd: 0,
    debtUsd: 0,
    limitUsd: null,
    relief: {
      kind: "boost",
      expiresAt: Date.now() + 60 * 60_000,
      effectiveLimit: 1_000_000,
    },
  };
  const merged = { ...base, ...over };
  // Token 主口径下 `used`/`tokenLimit` 与 `todayUsed`/`dailyLimit` 同源 ⇒ 用例只改后两者即可。
  return {
    ...merged,
    used: (over["used"] as number | undefined) ?? (merged.todayUsed as number),
    tokenLimit:
      (over["tokenLimit"] as number | undefined) ??
      (merged.dailyLimit as number),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 未保存过放行默认值 ⇒ 面板沿用 D-n / D-b 的默认（×2 / 1 小时 / 需二次确认）
  mocks.configGet.mockResolvedValue(null);
  // G-04：估算器默认返回零值；用例需要时再覆盖。当前模型默认清空（不触发请求）。
  mocks.estimateTurnCost.mockResolvedValue({
    costUsd: 0,
    unknownModel: false,
    inputTokens: 0,
    outputTokens: 0,
  });
  useModelSwitchStore.setState({ currentModelName: "" });
});

afterEach(() => {
  // 先卸载（否则下方 store 复位会向仍挂载的组件派发更新，触发 act 告警）
  cleanup();
  vi.unstubAllGlobals();
  useModelSwitchStore.setState({ currentModelName: "" });
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

describe("DailyBudgetPanel：撤销放行（DELETE /relief，D-b 对称回路）", () => {
  it("有放行时展示「撤销放行」按钮 ⇒ 点击调 clearDailyBudgetRelief 并按回包刷新", async () => {
    // 用**可变夹具**模拟真实后端：只有 DELETE 被调用后才不再回放行
    // （面板自身可能在挂载/语言就绪时重取 ⇒ 不能用 mockResolvedValueOnce 固定顺序）
    let reliefActive = true;
    mocks.getDailyBudget.mockImplementation(async () =>
      reliefActive
        ? budgetStatus()
        : budgetStatus({ relief: null, dailyLimit: 500_000 }),
    );
    mocks.clearDailyBudgetRelief.mockImplementation(async () => {
      reliefActive = false;
      return budgetStatus({ relief: null, dailyLimit: 500_000 });
    });

    render(<DailyBudgetPanel />);
    expect(await screen.findByText(/临时提额/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("daily-budget-revoke-relief"));

    await waitFor(() =>
      expect(mocks.clearDailyBudgetRelief).toHaveBeenCalledTimes(1),
    );
    // 撤销生效 ⇒ 提示已撤销，且「撤销放行」按钮随之消失
    expect(await screen.findByText(/已撤销放行/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByTestId("daily-budget-revoke-relief")).toBeNull(),
    );
  });

  it("无放行时**不**展示「撤销放行」按钮（无可撤销对象）", async () => {
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({ relief: null, dailyLimit: 500_000 }),
    );

    render(<DailyBudgetPanel />);
    expect(await screen.findByText("无")).toBeTruthy();
    expect(screen.queryByTestId("daily-budget-revoke-relief")).toBeNull();
  });
});

describe("DailyBudgetPanel：挂载请求次数（防 effect 抖动）", () => {
  it("挂载后只取一次日限额（不因无关依赖 identity 变化重复请求）", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus());

    render(<DailyBudgetPanel />);
    expect(await screen.findByText(/临时提额/)).toBeTruthy();

    // 留出窗口（语言就绪 / 微任务 / effect 二次执行）
    await new Promise((r) => setTimeout(r, 80));
    expect(mocks.getDailyBudget).toHaveBeenCalledTimes(1);
  });
});

/**
 * 债四 USD-3（2026-10-13，治理方案 §6.3）：金额口径上限编辑 + 用量展示。
 *
 * 与后端的**白盒契约**（`DailyBudgetUpdate.dailyLimitUSD`）：留空 ⇒ 发 `null`（清空=解除）；
 * 填写 ⇒ 正数（允许小数）；其它 ⇒ 400 ⇒ 前端**必须**在发送前拦下。
 * 展示侧：未配置上限（`null`）⇒ 显式「未启用」，**不显示 `$0.00`**（0 是"上限 0"的误读）。
 */
describe("DailyBudgetPanel：金额口径（USD-3）", () => {
  it("只读展示：已用金额 / 金额欠账 / 金额上限（已配置）", async () => {
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({ usedUsd: 1.5, debtUsd: 0.25, limitUsd: 20 }),
    );
    render(<DailyBudgetPanel />);

    expect(await screen.findByText("今日已用金额")).toBeTruthy();
    expect(screen.getByText("$1.50")).toBeTruthy();
    expect(screen.getByText("$0.25")).toBeTruthy();
    expect(screen.getByText("$20.00")).toBeTruthy();
  });

  it("未配置上限（null）⇒ 展示「未启用」而非 `$0.00`", async () => {
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({ usedUsd: 0, debtUsd: 0, limitUsd: null }),
    );
    render(<DailyBudgetPanel />);

    expect(await screen.findByText("金额上限")).toBeTruthy();
    expect(screen.getByText("未启用")).toBeTruthy();
    // `$0.00` 只应出现在「已用金额 / 金额欠账」（二者确实为 0 —— 如实展示）；
    // **上限**格必须是「未启用」，**不得**显示 `$0.00`（那是"上限 0 ⇒ 全额拒发"的误读）。
    expect(screen.getAllByText("$0.00")).toHaveLength(2);
  });

  it("G-03：未配置上限 ⇒ 灰色「闸门未启用」徽章 + 动态建议 placeholder", async () => {
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({ unit: "tokens", limitUsd: null }),
    );
    render(<DailyBudgetPanel />);
    await screen.findByText("限额配置");

    const badge = screen.getByTestId("daily-budget-usd-gate-badge");
    expect(badge.getAttribute("data-gate")).toBe("off");
    expect(badge.textContent).toContain("闸门未启用");
    expect(badge.className).toContain("text-gray-500");

    const input = screen.getByTestId(
      "daily-budget-usd-input",
    ) as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toContain("建议值");
    expect(input.getAttribute("placeholder")).toContain("未保存不生效");
  });

  it("G-03：已配置上限 ⇒ 绿色「金额闸门已激活」徽章", async () => {
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({ unit: "usd", dailyLimit: 10, limitUsd: 12.5, used: 1 }),
    );
    render(<DailyBudgetPanel />);
    await screen.findByText("限额配置");

    const badge = screen.getByTestId("daily-budget-usd-gate-badge");
    expect(badge.getAttribute("data-gate")).toBe("on");
    expect(badge.textContent).toContain("金额闸门已激活");
    expect(badge.className).toContain("text-green-600");
  });

  it("G-04：输入金额且已选模型 ⇒ 以服务端 DTO 展示 Token 约数（前端不自算）", async () => {
    useModelSwitchStore.setState({ currentModelName: "demo-model" });
    mocks.getDailyBudget.mockResolvedValue(budgetStatus({ limitUsd: null }));
    mocks.estimateTurnCost.mockResolvedValue({
      costUsd: 2.5,
      unknownModel: false,
      inputTokens: 5_000_000,
      outputTokens: 250_000,
    });
    render(<DailyBudgetPanel />);
    await screen.findByText("限额配置");

    // 300ms 去抖后才发起估算 ⇒ 由 waitFor 的 act 包裹推进定时器结果
    fireEvent.change(screen.getByTestId("daily-budget-usd-input"), {
      target: { value: "2.5" },
    });
    await waitFor(() =>
      expect(mocks.estimateTurnCost).toHaveBeenCalledWith({
        model: "demo-model",
        usd: 2.5,
      }),
    );

    const estimate = await screen.findByTestId("daily-budget-usd-estimate");
    expect(estimate.textContent).toContain("demo-model");
    expect(estimate.textContent).toContain("5,000,000");
    expect(estimate.textContent).toContain("250,000");
    expect(estimate.textContent).not.toContain("该模型未登记");
  });

  it("G-04：未登记模型 ⇒ 追加兜底价提示；未选模型 ⇒ 不发起估算请求", async () => {
    useModelSwitchStore.setState({ currentModelName: "unknown-model" });
    mocks.getDailyBudget.mockResolvedValue(budgetStatus({ limitUsd: null }));
    mocks.estimateTurnCost.mockResolvedValue({
      costUsd: 1,
      unknownModel: true,
      inputTokens: 1_000,
      outputTokens: 100,
    });
    const { unmount } = render(<DailyBudgetPanel />);
    await screen.findByText("限额配置");

    fireEvent.change(screen.getByTestId("daily-budget-usd-input"), {
      target: { value: "1" },
    });
    await waitFor(() => expect(mocks.estimateTurnCost).toHaveBeenCalled());
    const estimate = await screen.findByTestId("daily-budget-usd-estimate");
    expect(estimate.textContent).toContain("该模型未登记");

    // 未选模型 ⇒ 估算器不出请求（模型单价不可知，前端不猜）
    unmount();
    mocks.estimateTurnCost.mockClear();
    useModelSwitchStore.setState({ currentModelName: "" });
    render(<DailyBudgetPanel />);
    await screen.findByText("限额配置");

    fireEvent.change(screen.getByTestId("daily-budget-usd-input"), {
      target: { value: "2" },
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(mocks.estimateTurnCost).not.toHaveBeenCalled();
    expect(screen.queryByTestId("daily-budget-usd-estimate")).toBeNull();
  });

  it("金额主口径下 Token 观测阈值输入框取 `tokenLimit`（**非** `dailyLimit`）—— 真机 E2E 回归", async () => {
    // 真机实测（2026-10-15）：`dailyLimit` 在主口径切金额后是 **USD 有效上限**（本机 50），
    // 而该输入编辑的是 Token 观测阈值 ⇒ 修复前回显 `50`，且保存会把真实 `30_000_000` 覆盖为 50。
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({
        unit: "usd",
        dailyLimit: 50,
        limitUsd: 10,
        tokenLimit: 30_000_000,
      }),
    );
    mocks.updateDailyBudget.mockResolvedValue(budgetStatus());
    render(<DailyBudgetPanel />);
    await screen.findByText("每日预算限额");

    const input = screen.getByTestId(
      "daily-budget-token-threshold-input",
    ) as HTMLInputElement;
    expect(input.value).toBe("30000000"); // 修复前为 "50"

    fireEvent.click(screen.getByText("保存并生效"));
    await waitFor(() =>
      expect(mocks.updateDailyBudget).toHaveBeenCalledTimes(1),
    );
    expect(mocks.updateDailyBudget.mock.calls[0]?.[0]).toMatchObject({
      dailyLimit: 30_000_000, // 修复前提交 50
    });
  });

  it("输入留空 ⇒ 保存发 `dailyLimitUSD: null`（清空 = 解除）", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus());
    mocks.updateDailyBudget.mockResolvedValue(budgetStatus());
    render(<DailyBudgetPanel />);
    await screen.findByText("限额配置");

    fireEvent.click(screen.getByText("保存并生效"));

    await waitFor(() =>
      expect(mocks.updateDailyBudget).toHaveBeenCalledTimes(1),
    );
    expect(mocks.updateDailyBudget.mock.calls[0]?.[0]).toMatchObject({
      dailyLimitUSD: null,
    });
  });

  it("输入 12.5 ⇒ 保存发 `dailyLimitUSD: 12.5`（金额允许小数）", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus());
    mocks.updateDailyBudget.mockResolvedValue(budgetStatus({ limitUsd: 12.5 }));
    render(<DailyBudgetPanel />);
    await screen.findByText("限额配置");

    fireEvent.change(screen.getByTestId("daily-budget-usd-input"), {
      target: { value: "12.5" },
    });
    fireEvent.click(screen.getByText("保存并生效"));

    await waitFor(() =>
      expect(mocks.updateDailyBudget).toHaveBeenCalledTimes(1),
    );
    expect(mocks.updateDailyBudget.mock.calls[0]?.[0]).toMatchObject({
      dailyLimitUSD: 12.5,
    });
  });

  it("输入非法（负数）⇒ 不发请求 + 就地报错", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus());
    render(<DailyBudgetPanel />);
    await screen.findByText("限额配置");

    fireEvent.change(screen.getByTestId("daily-budget-usd-input"), {
      target: { value: "-1" },
    });
    fireEvent.click(screen.getByText("保存并生效"));

    expect(
      await screen.findByText("金额上限必须为正数（可含小数）"),
    ).toBeTruthy();
    expect(mocks.updateDailyBudget).not.toHaveBeenCalled();
  });
});

describe("DailyBudgetPanel：Token 轨只观测的措辞（台账 reopenWhen ④，2026-10-15）", () => {
  it("未配置金额上限（unit=tokens）⇒ 明示「无预算硬闸门」+ 徽章为「观测」+ 阈值不叫「日上限」", async () => {
    mocks.getDailyBudget.mockResolvedValue(budgetStatus({ unit: "tokens" }));
    render(<DailyBudgetPanel />);
    await screen.findByText("每日预算限额");

    // 显式「无闸门」提示（否则下方数字会被误读为生效额度）
    expect(screen.getByTestId("daily-budget-no-gate")).toBeTruthy();
    // 徽章不再显示「正常／已锁定」，改示「观测（不拦截）」
    expect(screen.getByText("观测（不拦截）")).toBeTruthy();
    // 阈值卡与配置输入改名（不再称「日上限」）
    expect(screen.getAllByText("Token 观测阈值").length).toBeGreaterThan(0);
    expect(screen.queryByText("日上限")).toBeNull();
  });

  it("无闸门状态：第一行按 **Token 基座**（`tokenLimit`）呈现，不被 relief 抬高值污染", async () => {
    // 真机实测（2026-10-15）：无闸门时卡显示 `150,000,000`（= 基座 ×5，relief 抬高），
    // 而配置输入与观测告警都用基座 `30,000,000` ⇒ 同屏自相矛盾。
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({
        unit: "tokens",
        limitUsd: null,
        todayUsed: 13_211_483,
        used: 13_211_483,
        dailyLimit: 150_000_000, // relief 抬高后的"有效值"（不得作为观测阈值展示）
        tokenLimit: 30_000_000,
      }),
    );
    render(<DailyBudgetPanel />);
    await screen.findByText("每日预算限额");

    expect(screen.getByText("30,000,000")).toBeTruthy(); // 观测阈值 = 基座
    expect(screen.getByText("16,788,517")).toBeTruthy(); // 剩余 = 基座 − 已用
    expect(screen.getByText("44.0%")).toBeTruthy(); // 比例 = 已用 / 基座
    expect(screen.queryByText("150,000,000")).toBeNull(); // relief 抬高值不得出现
    // 无闸门 ⇒ 不展示「当前有效上限」（relief 只作用于闸门，展示即误导）
    expect(screen.queryByText("当前有效上限")).toBeNull();
  });

  it("无闸门提示为**纯文本**（不得残留 Markdown `**`）", async () => {
    // 真机实测：i18n 里写了 Markdown 粗体 ⇒ 面板纯文本渲染把 `**` 原样显示出来。
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({ unit: "tokens", limitUsd: null }),
    );
    render(<DailyBudgetPanel />);
    const note = await screen.findByTestId("daily-budget-no-gate");
    expect(note.textContent ?? "").not.toContain("**");
  });

  it("已配置金额上限（unit=usd）⇒ **不**显示无闸门提示，徽章回到档位、上限卡仍叫「日上限」", async () => {
    mocks.getDailyBudget.mockResolvedValue(
      budgetStatus({ unit: "usd", dailyLimit: 10, limitUsd: 10, used: 1 }),
    );
    render(<DailyBudgetPanel />);
    await screen.findByText("每日预算限额");

    expect(screen.queryByTestId("daily-budget-no-gate")).toBeNull();
    // 夹具 mode=locked ⇒ 档位口径生效
    expect(screen.getByText("已锁定（拒绝新调用）")).toBeTruthy();
    expect(screen.getAllByText("日上限").length).toBeGreaterThan(0);
  });
});
