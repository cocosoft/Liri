// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 悬浮窗几何（G8 窗口体验，2026-11-14）
 *
 * 解决两件事：
 * 1. **位置/尺寸记忆**：用户拖动/缩放后下次打开恢复（`localStorage`，纯 UI 偏好）；
 * 2. **多显示器边界校正**：显示器被拔掉/分辨率变化后，窗口不能"消失"在屏幕外 —— 用
 *    `clampToMonitors` 保证**至少 `FLOATING_MIN_VISIBLE_PX` 可见**（含标题栏拖拽区）。
 *
 * 坐标一律是**逻辑像素**（与 `WebviewWindow` 的 `x/y/width/height` 同口径）；
 * 物理↔逻辑转换在调用方（`floatingWindow.ts`）按各显示器 `scaleFactor` 完成。
 *
 * 本模块**不依赖 Tauri**（纯函数 + `localStorage`）⇒ 可在浏览器/单测直接跑。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 首次打开（无历史几何）时的默认尺寸（与一期创建参数一致） */
export const FLOATING_DEFAULT_SIZE = { width: 360, height: 220 } as const;

/** 至少要露出的像素（水平方向用于夹取；垂直方向保证标题栏在屏内） */
export const FLOATING_MIN_VISIBLE_PX = 48;

/** `localStorage` 键（单文件使用 ⇒ 按 `constants/storage.ts` 约定不上收） */
export const FLOATING_GEOMETRY_STORAGE_KEY = "liri-floating-geometry";

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 解析已保存的几何（损坏/缺字段/非正尺寸 ⇒ `null`，视为"没有保存过"） */
export function parseFloatingGeometry(raw: string | null): Rect | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // @ignore-catch — 损坏的本地几何等价于"没保存过"，回落到默认位置即可
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const source = parsed as Record<string, unknown>;
  const x = toFiniteNumber(source["x"]);
  const y = toFiniteNumber(source["y"]);
  const width = toFiniteNumber(source["width"]);
  const height = toFiniteNumber(source["height"]);
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** 序列化几何（取整，避免亚像素抖动写库） */
export function serializeFloatingGeometry(rect: Rect): string {
  return JSON.stringify({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
}

function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** 选目标显示器：中心点所在 > 重叠面积最大 > 第一个（确定性） */
function pickMonitor(rect: Rect, monitors: readonly Rect[]): Rect {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const containing = monitors.find(
    (m) =>
      centerX >= m.x &&
      centerX <= m.x + m.width &&
      centerY >= m.y &&
      centerY <= m.y + m.height
  );
  if (containing) return containing;

  let best = monitors[0];
  let bestArea = overlapArea(rect, best);
  for (const monitor of monitors.slice(1)) {
    const area = overlapArea(rect, monitor);
    if (area > bestArea) {
      best = monitor;
      bestArea = area;
    }
  }
  return best;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 把窗口矩形夹进显示器可见区（纯函数、确定性）。
 *
 * 规则：
 * - 与任何显示器**都无交集**（拔掉副屏等）⇒ 居中到**第一个**显示器（避免只剩一条缝）；
 * - 否则目标显示器 = 中心点所在，其次重叠最大，再次第一个；
 * - 尺寸不超过目标显示器；
 * - 位置保证「水平方向至少露出 `FLOATING_MIN_VISIBLE_PX`」且「标题栏不跑到屏幕上边界之上」；
 * - 无显示器信息（空数组）⇒ 原样返回（没有可依据的事实就不猜）。
 */
export function clampToMonitors(
  rect: Rect,
  monitors: readonly Rect[]
): Rect {
  if (monitors.length === 0) return { ...rect };

  const hasOverlap = monitors.some((m) => overlapArea(rect, m) > 0);
  if (!hasOverlap) {
    const fallback = monitors[0];
    const width = Math.max(1, Math.min(rect.width, fallback.width));
    const height = Math.max(1, Math.min(rect.height, fallback.height));
    return {
      x: fallback.x + (fallback.width - width) / 2,
      y: fallback.y + (fallback.height - height) / 2,
      width,
      height,
    };
  }

  const target = pickMonitor(rect, monitors);
  const width = Math.max(1, Math.min(rect.width, target.width));
  const height = Math.max(1, Math.min(rect.height, target.height));
  const minVisibleX = Math.min(FLOATING_MIN_VISIBLE_PX, width);
  const minVisibleY = Math.min(FLOATING_MIN_VISIBLE_PX, height);

  return {
    x: clampNumber(
      rect.x,
      target.x - width + minVisibleX,
      target.x + target.width - minVisibleX
    ),
    y: clampNumber(
      rect.y,
      target.y,
      target.y + target.height - minVisibleY
    ),
    width,
    height,
  };
}

/**
 * 该矩形是否**与任一显示器有交集**（用于判断"是否需要在挂载时重新定位"）。
 *
 * 口径是"有交集即可见"而不是"完全落在某块屏内"：跨两块屏的窗口同样可交互，
 * 只有**完全落在所有显示器之外**才需要校正。无显示器信息 ⇒ `true`（无从判断，不误判）。
 */
export function isRectVisible(
  rect: Rect,
  monitors: readonly Rect[]
): boolean {
  if (monitors.length === 0) return true;
  return monitors.some((m) => overlapArea(rect, m) > 0);
}

/** 读取已保存几何（无 `localStorage` / 损坏 ⇒ `null`） */
export function loadFloatingGeometry(): Rect | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return parseFloatingGeometry(
      localStorage.getItem(FLOATING_GEOMETRY_STORAGE_KEY)
    );
  } catch {
    // @ignore-catch — 隐私模式等禁用存储时等价于"没保存过"
    return null;
  }
}

/** 保存几何（存储不可用/配额满 ⇒ 静默跳过；几何丢失不影响功能） */
export function saveFloatingGeometry(rect: Rect): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      FLOATING_GEOMETRY_STORAGE_KEY,
      serializeFloatingGeometry(rect)
    );
  } catch {
    // @ignore-catch — 存储不可用只影响"下次恢复位置"，不阻断当前窗口
  }
}
