// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G8 一期：悬浮窗入口与窗口控制的**无 Tauri 环境**语义。
 *
 * 这些函数在浏览器/单测环境必须安全 no-op（不能因缺 Tauri 而抛错），
 * 否则 Web 预览与普通前端测试会被副窗口能力拖垮。
 */

import { describe, expect, it } from "vitest";
import {
  closeFloatingWindow,
  focusMainWindow,
  isFloatingEntry,
  isTauriRuntime,
  openFloatingWindow,
  FLOATING_WINDOW_LABEL,
} from "../lib/floatingWindow";

describe("floatingWindow（无 Tauri 运行时）", () => {
  it("isFloatingEntry 只认 floating 键", () => {
    expect(isFloatingEntry("?floating=1")).toBe(true);
    expect(isFloatingEntry("?floating")).toBe(true);
    expect(isFloatingEntry("?x=1&floating=true")).toBe(true);
    expect(isFloatingEntry("")).toBe(false);
    expect(isFloatingEntry("?x=1")).toBe(false);
  });

  it("非 Tauri ⇒ isTauriRuntime=false 且打开为 unsupported", async () => {
    expect(isTauriRuntime()).toBe(false);
    await expect(openFloatingWindow()).resolves.toBe("unsupported");
  });

  it("关闭/聚焦主窗口在非 Tauri 下安全 no-op", async () => {
    await expect(closeFloatingWindow()).resolves.toBeUndefined();
    await expect(focusMainWindow()).resolves.toBeUndefined();
  });

  it("窗口 label 固定为 floating（与 capabilities/floating.json 对齐）", () => {
    expect(FLOATING_WINDOW_LABEL).toBe("floating");
  });
});
