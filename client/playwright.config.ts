import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  // 显式配置 html reporter（默认行为，但显式声明确保 CI 失败时生成 playwright-report/）
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:1420",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // E2E 依赖真实后端（前端初始化 phase2 检查 /health + phase3 SSE）：
  // 先启动后端（--http-only，默认 18990），再启动前端 Vite（1420）。
  // CI 环境（CI=true）强制启动新实例；本地复用已在运行的服务。
  webServer: [
    {
      command: "bun run src/main.ts --http-only",
      cwd: "../app",
      // LocalHTTPService 的健康端点为 /v1/health/report（就绪前也返回 200），
      // 18990 上不存在 /health（那是 daemon 模式 9090 HealthServer 的端点），
      // 原 404 不在 Playwright 就绪状态码列表导致 webServer 等待超时（2026-08-15 修复）
      url: "http://127.0.0.1:18990/v1/health/report",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "bun run dev",
      url: "http://localhost:1420",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
