// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G8 窗口体验：悬浮窗几何的纯函数语义（位置/尺寸记忆 + 多显示器边界校正）。
 *
 * 锁定的语义：
 * - 损坏/缺字段/非正尺寸的本地几何 ⇒ `null`（视为没保存过，不猜）；
 * - 完全在屏内 ⇒ 原样返回（不改动用户摆放）；
 * - 越界 ⇒ 至少保留 `FLOATING_MIN_VISIBLE_PX` 可见（含标题栏拖拽区）；
 * - 尺寸大于目标显示器 ⇒ 收缩到显示器大小；
 * - 无显示器信息 ⇒ 原样返回（没有事实依据就不夹取）。
 */

import { describe, expect, it } from "vitest";
import {
  clampToMonitors,
  FLOATING_MIN_VISIBLE_PX,
  isRectVisible,
  parseFloatingGeometry,
  serializeFloatingGeometry,
  type Rect,
} from "../lib/floatingGeometry";

const PRIMARY: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const SECONDARY: Rect = { x: 1920, y: 0, width: 1280, height: 1024 };

describe("parseFloatingGeometry", () => {
  it("空 / 非法 JSON / 缺字段 / 非正尺寸 ⇒ null", () => {
    expect(parseFloatingGeometry(null)).toBeNull();
    expect(parseFloatingGeometry("")).toBeNull();
    expect(parseFloatingGeometry("{oops")).toBeNull();
    expect(parseFloatingGeometry('{"x":1,"y":2}')).toBeNull();
    expect(
      parseFloatingGeometry('{"x":1,"y":2,"width":0,"height":100}')
    ).toBeNull();
    expect(
      parseFloatingGeometry('{"x":1,"y":2,"width":100,"height":-5}')
    ).toBeNull();
    expect(
      parseFloatingGeometry('{"x":"1","y":2,"width":100,"height":100}')
    ).toBeNull();
  });

  it("合法几何可往返（序列化取整）", () => {
    const rect: Rect = { x: 100.4, y: 200.6, width: 360.2, height: 220.8 };
    expect(parseFloatingGeometry(serializeFloatingGeometry(rect))).toEqual({
      x: 100,
      y: 201,
      width: 360,
      height: 221,
    });
  });
});

describe("clampToMonitors", () => {
  it("完全在屏内 ⇒ 原样返回", () => {
    const rect: Rect = { x: 100, y: 100, width: 360, height: 220 };
    expect(clampToMonitors(rect, [PRIMARY])).toEqual(rect);
  });

  it("水平部分越界 ⇒ 至少保留最小可见宽度", () => {
    // 仍与主屏有交集（1890..2250 覆盖 1890..1920，仅 30px < 48）⇒ 夹到"只露最小值"
    const rect: Rect = { x: 1890, y: 100, width: 360, height: 220 };
    expect(clampToMonitors(rect, [PRIMARY]).x).toBe(
      PRIMARY.width - FLOATING_MIN_VISIBLE_PX
    );
  });

  it("上边界部分越界 ⇒ 拉回显示器顶部", () => {
    const rect: Rect = { x: 100, y: -100, width: 360, height: 220 };
    expect(clampToMonitors(rect, [PRIMARY]).y).toBe(0);
  });

  it("尺寸大于显示器 ⇒ 收缩到显示器大小", () => {
    const small: Rect = { x: 0, y: 0, width: 800, height: 600 };
    const rect: Rect = { x: 10, y: 10, width: 1600, height: 1200 };
    expect(clampToMonitors(rect, [small])).toEqual({
      x: 10,
      y: 10,
      width: 800,
      height: 600,
    });
  });

  it("位于副屏 ⇒ 保留在副屏（不被拉回主屏）", () => {
    const rect: Rect = { x: 2000, y: 200, width: 360, height: 220 };
    expect(clampToMonitors(rect, [PRIMARY, SECONDARY])).toEqual(rect);
  });

  it("完全在所有显示器外 ⇒ 居中到第一个显示器（不留半条缝）", () => {
    const rect: Rect = { x: 9000, y: 100, width: 360, height: 220 };
    const clamped = clampToMonitors(rect, [PRIMARY, SECONDARY]);
    expect(clamped).toEqual({
      x: (PRIMARY.width - 360) / 2,
      y: (PRIMARY.height - 220) / 2,
      width: 360,
      height: 220,
    });
  });

  it("无显示器信息 ⇒ 原样返回", () => {
    const rect: Rect = { x: -9999, y: -9999, width: 360, height: 220 };
    expect(clampToMonitors(rect, [])).toEqual(rect);
  });
});

describe("isRectVisible", () => {
  it("与任一显示器有交集 ⇒ true；完全在外 ⇒ false", () => {
    expect(
      isRectVisible({ x: 10, y: 10, width: 100, height: 100 }, [PRIMARY])
    ).toBe(true);
    // 跨界（跨两块屏）仍可交互 ⇒ 视为可见
    expect(
      isRectVisible({ x: 1900, y: 10, width: 100, height: 100 }, [PRIMARY])
    ).toBe(true);
    expect(
      isRectVisible({ x: 5000, y: 10, width: 100, height: 100 }, [PRIMARY])
    ).toBe(false);
    expect(
      isRectVisible({ x: 5000, y: 10, width: 100, height: 100 }, [
        PRIMARY,
        SECONDARY,
      ])
    ).toBe(false);
  });

  it("无显示器信息 ⇒ 视为可见（不误判为需要重定位）", () => {
    expect(isRectVisible({ x: 0, y: 0, width: 10, height: 10 }, [])).toBe(true);
  });
});
