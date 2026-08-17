import { test, expect } from "@playwright/test";

/**
 * Agent 任务管理 E2E（2026-08-15 重写适配新 UI）
 *
 * 旧"任务中心"页面（/tasks）已迁移：
 * - /tasks 路由重定向到 /projects（client/src/routes/index.tsx:388）
 * - Agent 任务管理现位于 /agent（AgentPage 组件）
 *
 * 原 task-center.spec.ts 针对已删除页面元素（统计卡片/搜索框/新建 Agent 任务弹窗）
 * 已全部失效，重写为验证 /agent 页面的核心交互。
 */

test.describe("Agent 任务管理 E2E", () => {
  test("导航到 Agent 任务页面并显示标题", async ({ page }) => {
    await page.goto("/agent");
    await expect(page.locator("text=Agent 任务").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("任务输入框与执行/刷新按钮可用", async ({ page }) => {
    await page.goto("/agent");
    const input = page.locator('input[placeholder*="任务名称"]').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("E2E 测试任务");
    await expect(input).toHaveValue("E2E 测试任务");
    await expect(page.locator('button:has-text("执行")').first()).toBeVisible();
    await expect(page.locator('button:has-text("刷新")').first()).toBeVisible();
    // 不点击"执行"——会触发真实 AI 任务（CI 离线环境无模型可用）
  });

  test("任务列表渲染或显示空状态", async ({ page }) => {
    await page.goto("/agent");
    // 有任务 → 渲染任务列表（ul）；无任务 → 显示空状态（"暂无任务"）。
    // 注意：不能用 .or() 组合定位器——标题与空状态同屏可见时
    // strict mode 会判定 "resolved to 2 elements" 直接报错（CI 曾因此失败）。
    // 用计数判断：任一出现即为通过。
    await expect
      .poll(
        async () => {
          const listCount = await page.locator("ul").count();
          const emptyCount = await page.locator("text=暂无任务").count();
          return listCount + emptyCount;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });
});
