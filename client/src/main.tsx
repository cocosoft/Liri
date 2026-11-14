import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./i18n";
import App from "./App";
import "./index.css";
import { getOTelTracing } from "./monitoring/otel";
import { createLogger } from "@/utils/logger";
// G8（2026-11-14）：全局悬浮窗入口（`?floating=1`）
import { FloatingPanel } from "./components/Floating/FloatingPanel";
import { isFloatingEntry } from "./lib/floatingWindow";

const logger = createLogger("main");

// 初始化前端 OTEL 追踪 — serviceVersion 唯一事实来源 /v1/app/info（后端 app/package.json）
async function initOTelTracing() {
  try {
    const { httpLegacy } = await import("./services/httpClient");
    const info = await httpLegacy.get<{ version: string }>("/v1/app/info");
    getOTelTracing({ serviceVersion: info.version });
  } catch {
    // 版本获取失败使用占位版本，不阻塞 OTel 启动
  } finally {
    getOTelTracing().init();
  }
}
void initOTelTracing();

// 全局崩溃捕获：unhandledrejection + error 事件 — STATUS_BREAKPOINT 等进程级崩溃的兜底日志
window.addEventListener("unhandledrejection", (event) => {
  logger.error("[Crash] unhandledrejection", {
    reason: String(event.reason),
    stack: event.reason?.stack?.slice(0, 500),
  });
});
window.addEventListener("error", (event) => {
  logger.error("[Crash] global error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack?.slice(0, 500),
  });
});

// G8（2026-11-14）：副窗口入口 —— `index.html?floating=1` 只渲染悬浮面板，
// 不挂 Router / App（悬浮窗不承担主界面的路由与初始化链路）。
const root = ReactDOM.createRoot(document.getElementById("root")!);
if (isFloatingEntry(window.location.search)) {
  root.render(
    <React.StrictMode>
      <FloatingPanel />
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}
