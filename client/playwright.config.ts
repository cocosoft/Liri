import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:1420',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // E2E 依赖真实后端（前端初始化 phase2 检查 /health + phase3 SSE）：
  // 先启动后端（--http-only，默认 7890），再启动前端 Vite（1420）。
  // CI 环境（CI=true）强制启动新实例；本地复用已在运行的服务。
  webServer: [
    {
      command: 'bun run src/main.ts --http-only',
      cwd: '../app',
      url: 'http://127.0.0.1:7890/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'bun run dev',
      url: 'http://localhost:1420',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
