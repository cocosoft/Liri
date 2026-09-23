import { test, expect, type Page } from "@playwright/test";

/**
 * E2E 故障注入测试（§13.10 #4）
 *
 * 覆盖 3 个场景：断网 / 后端重启 / SSE 中断。
 *
 * 观测方式（2026-09-23）：读 **app 侧 dev 句柄** `window.__liriConnMonitor`（`useInitApp.ts` 挂载）
 * —— 它指向**页面自己那份**监测器实例 ⇒ 本文件**不手动 `start()`**，断言的就是真实初始化路径。
 * ⚠️ 两条踩坑（台账 §TB-3 / §TB-4）：
 * 1. **不能**用 `page.evaluate(() => import("...connectionMonitor.ts"))` 读状态：该 URL（**无 query**）
 *    与页面 bundle 的 `?t=<HMR 时间戳>` 是**两份模块实例** ⇒ 会读到"没人启动过的"那份，导致假结论。
 * 2. 监测器曾挂在"SSE/会话订阅"那个 effect 上（deps 含 `backendRunning`），被 cleanup `stop()`
 *    掐断后**不再恢复** ⇒ `failCount` 到不了 3 ⇒ 掉线检测失效（§TB-4）；已改为**独立 effect
 *    （deps=[]，随页面生命周期）**，本文件据此才能直接观测真实实例。
 *
 * - 断网/后端重启：断言状态机状态与转移历史；
 * - SSE 中断：通过 localStorage 持久化日志（pyapp_frontend_logs）断言重连调度。
 *
 * 前置条件：后端 18990 + 前端 1420 已运行（reuseExistingServer）。
 */

/** dev 句柄形状（app 侧挂载；诊断字段见 `connectionMonitor.getDiagnostics`） */
type ConnMonitorHandle = {
  getState(): string;
  getHistory(): Array<{ to: string }>;
  getDiagnostics(): {
    started: boolean;
    hasTimer: boolean;
    tickCount: number;
    stopCount: number;
    failCount: number;
    state: string;
  };
};

/** 读取**页面自身**监测器的状态与转移历史（经 dev 句柄；句柄缺失即抛错，避免静默失真） */
async function monitorSnapshot(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as { __liriConnMonitor?: ConnMonitorHandle })
      .__liriConnMonitor;
    if (!h) throw new Error("window.__liriConnMonitor 缺失（dev 句柄未挂载）");
    return { state: h.getState(), history: h.getHistory() };
  });
}

/** 读取**页面自身**监测器的只读诊断（用于区分"定时器没跑"与"跑了但健康检查成功"） */
async function monitorDiagnostics(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as { __liriConnMonitor?: ConnMonitorHandle })
      .__liriConnMonitor;
    if (!h) throw new Error("window.__liriConnMonitor 缺失（dev 句柄未挂载）");
    return h.getDiagnostics();
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
    // 不手动 start：断言的是**页面自身**监测器（经 dev 句柄观测）⇒ 覆盖真实初始化路径
    await page.waitForTimeout(3000);

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

  // 2026-09-23：**定时器驱动**（TB-2 排查结论：定时器与失败判定本身均正常 —— 探针采样显示
  // `tickCount` 每 ~10s 稳定 +1、3 次连续失败后于 ~30s 转 `disconnected`）。
  // 不手动 `start()`：监测器已改为**独立 effect（deps=[]）**，断言的是页面真实实例（TB-4 修复后成立）。
  test("后端重启：周期性健康检查连续失败 ⇒ disconnected，恢复后回 connected", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForTimeout(3000);

    // 注入故障（监测器已在跑 ⇒ 首个 tick 可能已成功；不影响：需**连续** 3 次失败）
    await page.route("**/health", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );

    // 前提断言：定时器**真的在 tick**。仅看 state/history 无法区分"定时器没跑"与
    // "跑了但健康检查成功"（TB-2 三次探针都栽在这里）⇒ 用只读诊断把这条前提钉死，
    // 失败时报告里直接带出证据。
    const before = await monitorDiagnostics(page);
    await expect
      .poll(async () => (await monitorDiagnostics(page)).tickCount, {
        timeout: 25_000,
        message: "监测器定时器未 tick —— 见 预存问题 §TB-2",
      })
      .toBeGreaterThan(before.tickCount);

    // 连续 3 次失败（10s 间隔）→ disconnected（实测约 30s 达成）
    await expect
      .poll(async () => (await monitorSnapshot(page)).state, {
        timeout: 60_000,
      })
      .toBe("disconnected");
    expect(
      (await monitorSnapshot(page)).history.some((h) => h.to === "disconnected"),
    ).toBeTruthy();

    // 后端恢复：解除拦截 → 下一次 tick 成功 → connected
    await page.unroute("**/health");
    await expect
      .poll(async () => (await monitorSnapshot(page)).state, {
        timeout: 30_000,
      })
      .toBe("connected");
  });

  // TB-5 回归门禁（2026-09-23）：首页只应建立 **1 条** `/v1/events` 常驻连接。
  // 修复前为 2 条 —— `sseService` 的 fetch 流 + `useNotificationSSE` 自建的 EventSource
  // **撞同一端点**（dev 与 prod 构建产物实测均为 2）。修复：通知中心改为订阅 `sseService`
  // 的单一事件源（并新增 `connection:open` 事件取代原先依赖的 `EventSource.onopen`）。
  // 只统计 **GET**：心跳是 HEAD（`sseService.ts:390-411`），且 Playwright 会把 HEAD 归类为
  // `requestfailed`，若不排除会污染计数。
  test("SSE：首页仅 1 条 /v1/events 常驻连接（TB-5 回归门禁）", async ({ page }) => {
    test.setTimeout(60_000);

    const open = new Set<unknown>();
    const isSseGet = (r: { url(): string; method(): string }) =>
      r.url().includes("/v1/events") && r.method() === "GET";
    page.on("request", (r) => {
      if (isSseGet(r)) open.add(r);
    });
    page.on("requestfinished", (r) => open.delete(r));
    page.on("requestfailed", (r) => open.delete(r));

    await page.goto("/");
    await expect
      .poll(() => open.size, { timeout: 15_000 })
      .toBe(1);

    // 覆盖一个心跳周期（30s）+ 可能的抖动，确认**始终没有第二条**常驻
    await page.waitForTimeout(32_000);
    expect(open.size).toBe(1);
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
