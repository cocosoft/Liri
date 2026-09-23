import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// 端口归一化（2026-08-27）：后端 HTTP 端口运行时事实来源为 LIRI_HTTP_PORT
// （app/.env 定义、后端 main.ts 读取），此处 proxy target 跟随同一变量。
// fallback 默认 18990（与 app/src/core/ports.ts / client/src/services/backendUrl.ts 一致），
// 变更端口只需修改 app/.env 的 LIRI_HTTP_PORT，全链路自动跟随。
const _backendPort =
  Number(loadEnv("", path.resolve(__dirname, "../app"), "").LIRI_HTTP_PORT) ||
  18990;
const BACKEND_TARGET = `http://127.0.0.1:${_backendPort}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  clearScreen: false,
  cacheDir: "node_modules/.vite",
  optimizeDeps: {
    entries: ["src/**/*.{ts,tsx,js,jsx}"],
    include: [
      "react",
      "react-dom",
      "react-router-dom",
      "zustand",
      "react-markdown",
      "rehype-highlight",
      "react-i18next",
      "i18next",
      "@tauri-apps/api/core",
      "@tauri-apps/plugin-shell",
      // 2026-08-23 补全：应用实际 import 的重型依赖必须显式预构建，
      // 否则运行时发现新依赖触发重新优化 → 旧请求 504 (Outdated Optimize Dep) → 页面加载卡死
      "katex",
      "rehype-katex",
      "remark-math",
      "remark-gfm",
      "rehype-raw",
      "mermaid",
      "dompurify",
      "highlight.js",
      "@tanstack/react-virtual",
      "lucide-react",
      "xlsx",
      "mammoth",
      "pptx-viewer",
      "@xyflow/react",
      "dagre",
      "@xterm/xterm",
      "@xterm/addon-fit",
      "@xterm/addon-web-links",
    ],
  },
  server: {
    host: true,
    port: 1420,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1420,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/api": {
        target: BACKEND_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
              if (res && !res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Backend unavailable" }));
              }
            }
          });
        },
      },
      "/v1": {
        target: BACKEND_TARGET,
        changeOrigin: true,
        // 3.4/P1-1：启用 WebSocket 升级转发（流式 STT 端点 /v1/voice/stt）
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
              if (res && !res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Backend unavailable" }));
              }
            }
          });
        },
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
    // 覆盖率门槛（P2-4 剩余子项，2026-09-23）
    //
    // 设计取舍：
    // - `enabled: false` ⇒ 既有 `bun run test`（CI client-test 步骤）**不受影响、不降速**；
    //   门槛由 `bun run test:coverage` 显式触发（CI 已加一步）。
    // - 门槛**只设在实测已达标的文件上**（下设数值全部取自 2026-09-23 实测，不拍脑袋）：
    //   派生 / 过滤 / 快照解析四个文件**行覆盖已 100%** ⇒ 锁 100% 防回归。
    // - 组件区实测薄弱（`TrajectoryFilter` / `TrajectoryPlayer` 0%、`TrajectoryTimeline` ~40%）
    //   ⇒ **刻意不设门槛**：设了就立即红，设 0 是假门槛。该缺口已登记到
    //   `dev_docs/error_repairs/预存错误与待处理问题.md`（TC-1），不在此粉饰。
    coverage: {
      provider: "v8",
      enabled: false,
      include: [
        "src/stores/chat/deriveTrajectory*.ts",
        // API 指标展示（2026-09-23）：请求级聚合纯函数（`deriveTrajectory*` 命名不匹配 ⇒ 单独列出）
        "src/stores/chat/deriveApiMetrics.ts",
        // P2-2（2026-09-23）：请求区间派生纯函数（同上，命名不匹配 ⇒ 单独列出）
        "src/stores/chat/deriveRequestSpans.ts",
        "src/stores/chat/filterTrajectoryEvents.ts",
        "src/stores/chat/resolveModelInputSnapshot.ts",
        "src/stores/chat/trajectoryStore.ts",
        "src/components/Trajectory/**",
        "src/components/common/JsonTree.tsx",
      ],
      reporter: ["text"],
      thresholds: {
        // 以下**每个 glob 只匹配一个文件**（避免"逐文件 vs 聚合"的语义歧义），阈值取自
        // 2026-09-23 实测值并留 1~2 点余量 ⇒ 作用有二：
        // ① 已达 100% 的文件**锁死**（防回归）；② 尚未达标的文件作为**棘轮**（只许升不许降）。
        // 待补齐组件测试后应逐步上调（见 `预存错误与待处理问题.md` §TC-1）。
        "src/stores/chat/deriveTrajectoryLayout.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 98, // 实测 98.24
        },
        // API 指标展示（2026-09-23）：新建纯函数，单测已四项全满 ⇒ 锁 100%（棘轮只许升不许降）
        "src/stores/chat/deriveApiMetrics.ts": {
          lines: 100, // 实测 100
          statements: 100, // 实测 100
          functions: 100, // 实测 100
          branches: 100, // 实测 100
        },
        // P2-2（2026-09-23）：请求区间派生（新建纯函数）⇒ 棘轮，按实测留 1 点余量
        // （未覆盖：空 starts 早退后的边界 107-108 与 180 的 `end` 差值兜底分支）
        "src/stores/chat/deriveRequestSpans.ts": {
          lines: 100, // 实测 100
          statements: 97, // 实测 98
          functions: 100, // 实测 100
          branches: 92, // 实测 93.02
        },
        "src/stores/chat/deriveTrajectoryTimeline.ts": {
          lines: 100,
          statements: 96, // 实测 96.72（`Uncovered: 227,232,259,293`）
          functions: 100,
          branches: 89, // 实测 89.71
        },
        "src/stores/chat/filterTrajectoryEvents.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 91, // 实测 91.66
        },
        "src/stores/chat/resolveModelInputSnapshot.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 95, // 实测 95.45
        },
        // TC-1 补测后：0% → 100%（本文件原为零覆盖）
        "src/components/Trajectory/TrajectoryFilter.tsx": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 92, // 实测 92.1
        },
        "src/components/Trajectory/TrajectoryPlayer.tsx": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 以下为**棘轮**（TC-1 补测后已上调；只许升不许降）
        "src/components/Trajectory/TrajectoryDetail.tsx": {
          lines: 100, // 实测 100（补测前 83.87）
          statements: 96, // 实测 96.96
          functions: 91, // 实测 91.66
          branches: 77, // 实测 77.35
        },
        "src/components/Trajectory/TrajectoryRow.tsx": {
          lines: 100, // 实测 100（补测前 72.97）
          statements: 95, // 实测 95.45
          functions: 100,
          branches: 85, // 实测 86
        },
        // TC-1 补测（2026-09-23）：几何/指针路径已由 jsdom stub 覆盖 —— 测试内按实例
        // stub `getBoundingClientRect`（非零宽度）并派发**原生** wheel/pointer 事件，
        // 故缩放 / 拖拽选区 / 右键平移 / 视图过滤全部可断言。阈值按实测留 1~2 点余量。
        "src/components/Trajectory/TrajectoryTimeline.tsx": {
          lines: 99, // 实测 100（补测前 40.33）
          statements: 95, // 实测 96.55
          functions: 99, // 实测 100
          branches: 91, // 实测 92.68
        },
        "src/components/common/JsonTree.tsx": {
          lines: 95, // 实测 95.83
          statements: 95, // 实测 96.29
          functions: 100,
          branches: 90, // 实测 96.29
        },
        "src/stores/chat/trajectoryStore.ts": {
          lines: 82, // 实测 82.53（补测前 68.25）
          statements: 80, // 实测 81.33
          functions: 100,
          branches: 68, // 实测 68.75
        },
      },
    },
  },
});
