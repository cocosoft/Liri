import { test, expect } from '@playwright/test';

test.describe('Liri Task Center E2E', () => {

  test('首页加载并显示界面', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Liri').first()).toBeVisible({ timeout: 10_000 });
  });

  test('导航到任务中心页面', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.locator('text=任务中心')).toBeVisible({ timeout: 10_000 });
  });

  test('任务中心显示统计卡片', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.locator('text=总任务').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=已完成').first()).toBeVisible({ timeout: 5_000 });
  });

  test('搜索框可用', async ({ page }) => {
    await page.goto('/tasks');
    const searchInput = page.locator('input[placeholder*="搜索"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill('测试');
    await expect(searchInput).toHaveValue('测试');
  });

  test('新建 Agent 任务弹窗可打开和关闭', async ({ page }) => {
    await page.goto('/tasks');
    const createBtn = page.locator('text=新建 Agent 任务').first();
    await createBtn.click();
    await expect(page.locator('text=任务名称').first()).toBeVisible({ timeout: 3_000 });
    const cancelBtn = page.locator('button:has-text("取消")');
    await cancelBtn.click();
    await expect(page.locator('text=任务名称').first()).not.toBeVisible({ timeout: 3_000 });
  });

});
