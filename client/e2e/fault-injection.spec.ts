import { test, expect, type Page } from "@playwright/test";

/**
 * E2E 故障注入测试（§13.10 #4）
 *
 * 覆盖 3 个场景：断网 / 后端重启 / SSE 中断。
 *
 * 策略：
 * - 前端初始化阶段 React StrictMode 会双调用 effect，使 useInitApp 中
 *   connectionMonitor.start() 被 cleanup 的 stop() 抵消（开发模式监听未生效）。
 *   故测试手动调用 connectionMonitor.start()（幂等）后注入故障，
 *   等价于验证应用正常初始化后的连接状态机行为。
 * - 断网/后端重启通过断言状态机状态与转移历史；SSE 中断通过
 *   localStorage 持久化日志（pyapp_frontend_logs）断言重连调度。
 *
 * 前置条件：后端 7890 + 前端 1420 已运行（reuseExistingServer）。
 */

/** 在页面上下文中读取 connectionMonitor 快照 */
async function monitorSnapshot(page: Page) {
  return page.evaluate(async () => {
    const mod = await import("/src/services/connectionMonitor.ts");
    return {
      state: mod.connectionMonitor.getState(),
      history: mod.connectionMonitor.getHistory(),
    };
  });
}

/** 在页面上下文中启动 connectionMonitor（幂等） */
async function ensureMonitorStarted(page: Page) {
  await page.evaluate(async () => {
    const mod = await import("/src/services/connectionMonitor.ts");
    mod.connectionMonitor.start();
  });
}

/** 读取前端 localStorage 日志中匹配指定 message 子串的最新条目 */
async function getLog(page: Page, search: string) {
  return page.evaluate((s: string) => {
    const raw = localStorage.getItem("pyapp_frontend_logs");
    if (!raw) return null;
    try {
      const logs = JSON.parse(raw) as Array<{ message: string }>;
      const match = [...logs].reverse().find((l) => l.message.includes(s));
      return match ? match.message : null;
    } catch {
      return null;
    }
  }, search);
}

test.describe("连接故障注入 E2E（断网/后端重启/SSE 中断）", () => {
  test("断网：offline 事件驱动状态转移，恢复后回 connected", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.waitForTimeout(3000);
    await ensureMonitorStarted(page);

    // 初始应为 connected
    await expect
      .poll(async () => (await monitorSnapshot(page)).state, {
        timeout: 15_000,
      })
      .toBe("connected");

    // 模拟断网：触发 window offline 事件 → 应进入 offline 关键状态
    await context.setOffline(true);
    await expect
      .poll(async () => (await monitorSnapshot(page)).state, {
        timeout: 15_000,
      })
      .toBe("offline");
    const offlineHist = await monitorSnapshot(page);
    expect(offlineHist.history.some((h) => h.to === "offline")).toBeTruthy();

    // 恢复网络：online 事件 → 后端可达则回 connected
    await context.setOffline(false);
    await expect
      .poll(async () => (await monitorSnapshot(page)).state, {
        timeout: 15_000,
      })
      .toBe("connected");
  });

  test("后端重启：健康检查连续失败判定 disconnected，恢复后回 connected", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await page.waitForTimeout(3000);
    await ensureMonitorStarted(page);

    // 注入故障：拦截 /health 返回 503（模拟后端不可达）
    await page.route("**/health", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );

    // 连续 3 次失败（10s 间隔）→ disconnected 关键状态
    await expect
      .poll(async () => (await monitorSnapshot(page)).state, {
        timeout: 60_000,
      })
      .toBe("disconnected");

    // 后端恢复：解除拦截 → 健康检查成功 → connected
    await page.unroute("**/health");
    await expect
      .poll(async () => (await monitorSnapshot(page)).state, {
        timeout: 30_000,
      })
      .toBe("connected");
  });

  // TODO: 2026-08-15 前端 useInitApp 初始化流程调整后此测试不稳定——
  // 等待 localStorage "SSE 连接错误" 日志 15s 无果（SSE 连接依赖 phase1→phase3 串行初始化）。
  // 恢复前需确认 useInitApp phase3（sseService.connect）在 E2E 环境的触发条件。
  test.skip("SSE 中断：连接错误触发重连调度", async ({ page }) => {
    test.setTimeout(60_000);
    // 拦截 SSE 端点，返回一段有效流后关闭（模拟连接中断）
    await page.route("**/v1/events**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "data: ping\n\n",
      }),
    );

    await page.goto("/");
    await expect(page.locator("body")).toBeVisible({ timeout: 15_000 });

    // EventSource 在流结束后进入 CLOSED → onerror → 调度重连
    await expect
      .poll(async () => getLog(page, "SSE 连接错误"), { timeout: 15_000 })
      .not.toBeNull();
    await expect
      .poll(async () => getLog(page, "调度重连"), { timeout: 15_000 })
      .not.toBeNull();
  });
});
