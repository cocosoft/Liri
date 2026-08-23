import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
        target: "http://127.0.0.1:18990",
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
        target: "http://127.0.0.1:18990",
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
  },
});
