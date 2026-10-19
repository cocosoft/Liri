/**
 * 限额卡片两个动作的**宿主接线**回归锁（2026-10-19 真机反馈）。
 *
 * 真机现场：点「今日解除」与「限额设置」两个按钮"没反应"。
 *
 * 根因：
 *  - 「限额设置」`onOpenSettings` 原先只调 `handleDismissError()`（等于"关闭卡片"），
 *    并没有导航到配置面 ⇒ 看起来什么都没发生；
 *  - 「今日解除」在**挂起态**只清 `error/errorCode`，而卡片由 `suspendNotice` 驱动
 *    ⇒ 放行成功但卡片纹丝不动（放行本身已生效，只是没有可见反馈）。
 *
 * 为什么用源码扫描：`ChatArea` 依赖 10+ 个 store / 路由 / 主题上下文，渲染成本与脆弱度都高；
 * 本仓已有同类手法（`Sidebar/__tests__/systemItemsOverride.test.ts`）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CHAT_AREA = resolve(__dirname, "../ChatArea.tsx");

/** 取出 `<DailyLimitNotice ... />` 这段 JSX（宿主接线区间） */
function noticeBlock(src: string): string {
  const start = src.indexOf("<DailyLimitNotice");
  if (start < 0) throw new Error("未找到 <DailyLimitNotice> 渲染块");
  const end = src.indexOf("\n            />", start);
  if (end < 0) throw new Error("未找到 <DailyLimitNotice> 结束标记");
  return src.slice(start, end);
}

const src = readFileSync(CHAT_AREA, "utf-8");
const block = noticeBlock(src);

describe("ChatArea：DailyLimitNotice 动作接线", () => {
  it("「限额设置」必须导航到 /usage?tab=dailyLimit（不能只关卡片）", () => {
    const start = block.indexOf("onOpenSettings={() =>");
    expect(start).toBeGreaterThan(-1);
    const end = block.indexOf("onDismiss={() =>", start);
    const openSettings = block.slice(start, end);

    expect(openSettings).toContain('navigate("/usage?tab=dailyLimit")');
    // 旧实现（纯 no-op）不得回流
    expect(openSettings).not.toMatch(
      /^\s*onOpenSettings=\{\(\) => void handleDismissError\(\)\}/m,
    );
  });

  it("「今日解除」成功 ⇒ 挂起态必须收起卡片（否则看起来没反应）", () => {
    const start = block.indexOf("onRelief={(kind) =>");
    expect(start).toBeGreaterThan(-1);
    const end = block.indexOf("onContinue={() =>", start);
    const relief = block.slice(start, end);

    expect(relief).toMatch(/if \(isSuspended\) setSuspendNotice\(null\)/);
  });
});
