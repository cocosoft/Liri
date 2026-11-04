/**
 * P1（2026-11-04）：会话级权限模式选择器的**文案完整性**守卫。
 *
 * 为什么要有这条：9 档模式名与说明都是 `t()` 动态拼键（`chat.permission.mode.<key>`），
 * 拼错的键不会编译报错，只会在界面上直接显示 key 原文。本用例锁：
 *   ① 键集合 = 9 档且不重复（与后端 `PERMISSION_MODES` 同集合）；
 *   ② zh / en 两份语言包对每档都有非空的模式名与说明。
 *
 * 注：不渲染组件（jsdom + store mock 成本高、收益低），只校验契约数据。
 */
import { describe, it, expect } from "vitest";
import { PERMISSION_MODE_KEYS } from "../permissionModeOptions";
import zhBase from "@/i18n/locales/zh/base";
import enBase from "@/i18n/locales/en/base";

type ChatSection = {
  permission?: {
    mode?: Record<string, string>;
    modeDesc?: Record<string, string>;
  };
};

function permissionSection(
  locale: unknown,
): NonNullable<ChatSection["permission"]> {
  const permission = (locale as { chat?: ChatSection }).chat?.permission;
  expect(permission).toBeTruthy();
  return permission!;
}

describe("P1：权限模式选择器契约", () => {
  it("① 9 档且不重复", () => {
    expect(PERMISSION_MODE_KEYS).toHaveLength(9);
    expect(new Set(PERMISSION_MODE_KEYS).size).toBe(9);
  });

  it("② zh / en 均有每档的模式名与说明（非空字符串）", () => {
    for (const locale of [zhBase, enBase]) {
      const { mode, modeDesc } = permissionSection(locale);
      for (const key of PERMISSION_MODE_KEYS) {
        expect(typeof mode?.[key]).toBe("string");
        expect((mode?.[key] ?? "").trim().length).toBeGreaterThan(0);
        expect(typeof modeDesc?.[key]).toBe("string");
        expect((modeDesc?.[key] ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });
});
