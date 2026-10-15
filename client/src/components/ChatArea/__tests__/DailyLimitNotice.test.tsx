/**
 * T6（Spec `daily-budget-over-limit-ux.md` §5-A / §4 D-a/D-b/D-f）：
 * 撞限渲染**可操作限额卡片**（不再是红色错误条）。
 *
 * 契约（供 ChatArea 分流与测试）：
 * - props：`used` / `limit` / `unit` / `mode` + 四个回调（`onRelief` / `onContinue` /
 *   `onOpenSettings` / `onDismiss`）+ `t`（文案函数**由宿主注入**；组件不自行引入 i18n 实例）
 * - 口径（债四 S3，2026-10-15）：`unit === 'usd'` ⇒ `used` / `limit` 走**货币格式**，否则千分位整数
 * - 动作 → 回调语义：`onRelief(kind)` 把放行种类交给宿主调 `/v1/cost/daily-budget/relief`
 * - 文案键：`cost.card.*` / `cost.action.*`
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DailyLimitNotice, { isDailyLimitErrorCode } from "../DailyLimitNotice";

/** 文案键直通：便于断言"用了哪个键"，不绑定具体文案 */
const t = (key: string) => key;

function setup(over: Partial<Parameters<typeof DailyLimitNotice>[0]> = {}) {
  const props = {
    used: 901_200,
    limit: 500_000,
    unit: "tokens" as const,
    mode: "locked" as const,
    t,
    onRelief: vi.fn(),
    onContinue: vi.fn(),
    onOpenSettings: vi.fn(),
    onDismiss: vi.fn(),
    ...over,
  };
  render(<DailyLimitNotice {...props} />);
  return props;
}

describe("DailyLimitNotice：撞限卡片（D-a / D-b / D-f）", () => {
  it("渲染用量/上限 + 四个放行动作 + 「继续」（全部走 i18n 键，无硬编码文案）", () => {
    setup();
    expect(screen.getByText("cost.card.used")).toBeTruthy();
    // 用量/上限统一千分位（used 原先为原始数字 901200，与 limit 的 500,000 不一致）
    expect(screen.getByText("901,200")).toBeTruthy();
    expect(screen.getByText("500,000")).toBeTruthy();
    expect(screen.getByText("cost.action.boost")).toBeTruthy();
    expect(screen.getByText("cost.action.waiveOnce")).toBeTruthy();
    expect(screen.getByText("cost.action.unlockToday")).toBeTruthy();
    expect(screen.getByText("cost.action.openSettings")).toBeTruthy();
    expect(screen.getByText(/cost\.action\.continue/)).toBeTruthy();
  });

  it("口径随 `unit` 切换：`usd` ⇒ 用量/上限走货币格式（S3，2026-10-15）", () => {
    setup({ used: 9.5, limit: 10, unit: "usd" });
    expect(screen.getByText("$9.50")).toBeTruthy();
    expect(screen.getByText("$10.00")).toBeTruthy();
  });

  it("点「继续」⇒ onContinue（**显式**重发，不静默自动重发）", () => {
    const { onContinue } = setup();
    fireEvent.click(screen.getByText(/cost\.action\.continue/));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("点放行动作 ⇒ onRelief(kind)，由宿主去调 relief 端点", () => {
    const { onRelief } = setup();
    fireEvent.click(screen.getByText("cost.action.boost"));
    expect(onRelief).toHaveBeenLastCalledWith("boost");
    fireEvent.click(screen.getByText("cost.action.waiveOnce"));
    expect(onRelief).toHaveBeenLastCalledWith("waive-once");
    fireEvent.click(screen.getByText("cost.action.unlockToday"));
    expect(onRelief).toHaveBeenLastCalledWith("unlock-today");
  });

  it("「打开限额设置」⇒ onOpenSettings（直达配置面，D-h）", () => {
    const { onOpenSettings } = setup();
    fireEvent.click(screen.getByText("cost.action.openSettings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe("分流判据：非限额码仍走原红色错误条（**不回归**，T6 收尾例）", () => {
  it("限额码 ⇒ true（渲染限额卡片）", () => {
    expect(isDailyLimitErrorCode("DAILY_BUDGET_EXCEEDED")).toBe(true);
  });

  it("其它码 / 空 ⇒ false（渲染原红条，不被卡片吞掉）", () => {
    expect(isDailyLimitErrorCode("BACKEND_UNREACHABLE")).toBe(false);
    expect(isDailyLimitErrorCode("UNKNOWN")).toBe(false);
    expect(isDailyLimitErrorCode(null)).toBe(false);
    expect(isDailyLimitErrorCode(undefined)).toBe(false);
  });
});
