// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 全局悬浮窗（G8 一期，2026-11-14）
 *
 * 做法：复用 **Tauri 2 既有能力**（`@tauri-apps/api/webviewWindow`，已在 `package.json`）创建一个
 * `alwaysOnTop` 的无边框小窗，加载同一前端包的 `index.html?floating=1` —— 该入口由 `main.tsx`
 * 渲染 {@link FloatingPanel}（不再挂 Router/App，避免为副窗口维护第二套路由）。
 *
 * **一期不引入新外部依赖**：系统级全局快捷键需 `tauri-plugin-global-shortcut`（Rust crate + npm 包），
 * 列入二期（见 `.trae/specs/desktop-floating-window.md` §5）；一期入口为主窗口内 `Ctrl+Shift+F`。
 *
 * 浏览器（非 Tauri）环境下所有操作均为安全 no-op（返回 `unsupported`），便于前端单测与 Web 预览。
 */

/** 副窗口 label（Tauri 内唯一） */
export const FLOATING_WINDOW_LABEL = "floating";

/** 副窗口入口查询参数（`index.html?floating=1`） */
export const FLOATING_QUERY_KEY = "floating";

export type OpenFloatingResult = "opened" | "focused" | "unsupported";

/** 当前是否运行在 Tauri WebView 内 */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

/** 该 `search` 是否为悬浮窗入口（`?floating=1` / `?floating=true`，值无所谓，键存在即可） */
export function isFloatingEntry(search: string): boolean {
  return new URLSearchParams(search).has(FLOATING_QUERY_KEY);
}

/**
 * 打开（或聚焦）悬浮窗。
 *
 * @returns `opened` 新建 / `focused` 已存在并聚焦 / `unsupported` 非 Tauri 环境
 */
export async function openFloatingWindow(): Promise<OpenFloatingResult> {
  if (!isTauriRuntime()) return "unsupported";
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

  const existing = await WebviewWindow.getByLabel(FLOATING_WINDOW_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return "focused";
  }

  new WebviewWindow(FLOATING_WINDOW_LABEL, {
    url: `index.html?${FLOATING_QUERY_KEY}=1`,
    title: "Liri",
    width: 360,
    height: 220,
    minWidth: 280,
    minHeight: 160,
    resizable: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
  });
  return "opened";
}

/** 关闭当前悬浮窗（非 Tauri / 窗口不存在 ⇒ no-op） */
export async function closeFloatingWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const current = WebviewWindow.getCurrent();
  if (current.label === FLOATING_WINDOW_LABEL) {
    await current.close();
  }
}

/** 聚焦主窗口（悬浮窗上「回到主窗口」） */
export async function focusMainWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const main = await WebviewWindow.getByLabel("main");
  if (!main) return;
  await main.show();
  await main.setFocus();
}
