import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./i18n";
import App from "./App";
import "./index.css";
import { getOTelTracing } from "./monitoring/otel";

// 初始化前端 OTEL 追踪
getOTelTracing().init();

// 全局崩溃捕获：unhandledrejection + error 事件 — STATUS_BREAKPOINT 等进程级崩溃的兜底日志
window.addEventListener("unhandledrejection", (event) => {
  console.error("[Crash] unhandledrejection", {
    reason: String(event.reason),
    stack: event.reason?.stack?.slice(0, 500),
  });
});
window.addEventListener("error", (event) => {
  console.error("[Crash] global error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack?.slice(0, 500),
  });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
