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
 * **二期（2026-11-14）已接**：Rust 侧注册系统级 `Ctrl+Shift+F`，触发时仍只派发
 * `liri:toggle-floating` 事件 ⇒ 窗口创建**仍由本文件的 `openFloatingWindow` 单点实现**。
 *
 * 浏览器（非 Tauri）环境下所有操作均为安全 no-op（返回 `unsupported`），便于前端单测与 Web 预览。
 */

// G8 窗口体验（2026-11-14）：几何记忆 + 多显示器边界校正（纯函数，无 Tauri 依赖）
import {
  clampToMonitors,
  FLOATING_DEFAULT_SIZE,
  isRectVisible,
  loadFloatingGeometry,
  saveFloatingGeometry,
  type Rect,
} from "./floatingGeometry";

/** 副窗口 label（Tauri 内唯一） */
export const FLOATING_WINDOW_LABEL = "floating";

/** 副窗口入口查询参数（`index.html?floating=1`） */
export const FLOATING_QUERY_KEY = "floating";

/** G8 窗口体验（2026-11-14）：拖动/缩放后写回几何的防抖（ms） */
export const FLOATING_GEOMETRY_SAVE_DEBOUNCE_MS = 300;

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
 * G8 窗口体验（2026-11-14）：新建时优先恢复**上次几何**并做多显示器边界校正；
 * 无历史几何 ⇒ 维持一期行为（默认尺寸 + 居中）。
 *
 * @returns `opened` 新建 / `focused` 已存在并聚焦 / `unsupported` 非 Tauri 环境
 */
export async function openFloatingWindow(): Promise<OpenFloatingResult> {
  if (!isTauriRuntime()) return "unsupported";
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

  const existing = await WebviewWindow.getByLabel(FLOATING_WINDOW_LABEL);
  if (existing) {
    // G8 点击穿透（2026-11-14）：再次唤起 = 退出穿透（穿透态下窗口收不到点击，
    // 必须有"不用点窗口"的退出路径 ⇒ 复用既有 Ctrl+Shift+F / 托盘入口）
    try {
      await existing.setIgnoreCursorEvents(false);
    } catch {
      // @ignore-catch — 退出穿透失败不应阻断"显示并聚焦"这一主要目的
    }
    await existing.show();
    await existing.setFocus();
    return "focused";
  }

  const geometry = await resolveCreateGeometry();
  new WebviewWindow(FLOATING_WINDOW_LABEL, {
    url: `index.html?${FLOATING_QUERY_KEY}=1`,
    title: "Liri",
    ...FLOATING_DEFAULT_SIZE,
    minWidth: 280,
    minHeight: 160,
    resizable: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...(geometry
      ? {
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
        }
      : { center: true }),
  });
  return "opened";
}

/** 读取「显示器可见区（逻辑像素）」，供创建前夹取使用 */
async function readMonitorRects(): Promise<Rect[]> {
  const { availableMonitors } = await import("@tauri-apps/api/window");
  const monitors = await availableMonitors();
  return monitors.map((m) => ({
    x: m.position.x / m.scaleFactor,
    y: m.position.y / m.scaleFactor,
    width: m.size.width / m.scaleFactor,
    height: m.size.height / m.scaleFactor,
  }));
}

/** 新建窗口时的几何：无历史 ⇒ null（走默认居中）；有历史 ⇒ 夹进可见显示器 */
async function resolveCreateGeometry(): Promise<Rect | null> {
  const stored = loadFloatingGeometry();
  if (!stored) return null;
  try {
    return clampToMonitors(stored, await readMonitorRects());
  } catch {
    // @ignore-catch — 显示器信息不可读（权限/平台差异）⇒ 用历史几何，仍比丢失位置好
    return stored;
  }
}

/**
 * 在**悬浮窗自身**内初始化几何（G8 窗口体验）：挂载时校正一次 + 拖动/缩放后防抖保存。
 *
 * 必须在悬浮窗 webview 内调用（`getCurrentWebviewWindow()`）；非悬浮窗/非 Tauri ⇒ no-op。
 */
export async function initFloatingWindowGeometry(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { getCurrentWebviewWindow } =
    await import("@tauri-apps/api/webviewWindow");
  const win = getCurrentWebviewWindow();
  if (win.label !== FLOATING_WINDOW_LABEL) return;

  const readGeometry = async (): Promise<Rect> => {
    const factor = await win.scaleFactor();
    const position = (await win.outerPosition()).toLogical(factor);
    const size = (await win.innerSize()).toLogical(factor);
    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
  };

  // 显示器变化（拔掉副屏 / 分辨率变）后窗口可能整体在屏外 ⇒ 校正一次
  try {
    const current = await readGeometry();
    const monitors = await readMonitorRects();
    if (!isRectVisible(current, monitors)) {
      const clamped = clampToMonitors(current, monitors);
      const { LogicalPosition } = await import("@tauri-apps/api/dpi");
      await win.setPosition(
        new LogicalPosition(Math.round(clamped.x), Math.round(clamped.y)),
      );
    }
  } catch {
    // @ignore-catch — 校正失败不阻断窗口展示（用户仍可手动拖回）
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void readGeometry()
        .then(saveFloatingGeometry)
        .catch(() => {
          // @ignore-catch — 读取失败只影响"下次恢复位置"
        });
    }, FLOATING_GEOMETRY_SAVE_DEBOUNCE_MS);
  };

  await win.onMoved(persist);
  await win.onResized(persist);
}

/**
 * 开关悬浮窗的**点击穿透**（G8，2026-11-14）。
 *
 * 穿透态下窗口不接收鼠标事件（点击落到下层应用），因此**退出路径不依赖点击该窗口**：
 * 再按一次 `Ctrl+Shift+F`（系统级/应用内）或点托盘「悬浮窗」⇒ {@link openFloatingWindow}
 * 会先关闭穿透再显示聚焦（见函数内注释）。
 *
 * @returns `true` 已应用；`false` 非 Tauri / 窗口不存在 / 平台不支持（如实返回，不假装成功）
 */
export async function setFloatingPassthrough(
  enabled: boolean,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const target = await WebviewWindow.getByLabel(FLOATING_WINDOW_LABEL);
  if (!target) return false;
  try {
    await target.setIgnoreCursorEvents(enabled);
    return true;
  } catch {
    // @ignore-catch — 平台不支持该 API ⇒ 如实返回 false（界面据此提示，不静默成功）
    return false;
  }
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
