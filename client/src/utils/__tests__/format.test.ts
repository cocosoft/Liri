/**
 * HD-P2-2（硬编码统一治理方案 §3 / §7.2）—— 相对时间格式化的 **i18n 语言跟随**。
 *
 * 原缺陷：`formatRelativeTime()` 把文案（`"昨天"` / `` `${n}天前` ``）与
 * `toLocaleTimeString("zh-CN")` / `toLocaleDateString("zh-CN")` 一并**写死** ⇒
 * **英文界面下仍显示中文与中文日期格式**（既不是"数据"也不是"协议",
 * 而是纯用户可见文案 + 区域格式的双重硬编码）。
 *
 * 本测试同时钉住"改后不再回流"（源码守卫）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import i18n from "../../i18n";
import { formatRelativeTime } from "../format";

/** 明确早于 N 天（+2 小时缓冲，避免"刚好 24h"被 `Math.floor` 判成 0 天） */
function daysAgo(days: number): string {
  return new Date(Date.now() - (days * 24 + 2) * 3_600_000).toISOString();
}

const CJK = /[\u4e00-\u9fff]/;

afterEach(async () => {
  await i18n.changeLanguage("zh");
});

describe("HD-P2-2 · formatRelativeTime 跟随当前语言", () => {
  it("zh：昨天 / X天前 / 今日为 HH:MM", async () => {
    await i18n.changeLanguage("zh");
    expect(formatRelativeTime(daysAgo(1))).toBe("昨天");
    expect(formatRelativeTime(daysAgo(3))).toBe("3天前");
    expect(formatRelativeTime(new Date().toISOString())).toMatch(
      /^\d{1,2}:\d{2}/,
    );
  });

  it("en：Yesterday / X days ago，且**不再含中文**（原缺陷的正题）", async () => {
    await i18n.changeLanguage("en");
    expect(formatRelativeTime(daysAgo(1))).toBe("Yesterday");
    expect(formatRelativeTime(daysAgo(3))).toBe("3 days ago");
    for (const days of [1, 3, 30]) {
      expect(formatRelativeTime(daysAgo(days))).not.toMatch(CJK);
    }
  });

  it("en：日期区域格式随语言切换（不再是中文月份）", async () => {
    await i18n.changeLanguage("en");
    const older = formatRelativeTime(daysAgo(30));
    expect(older).not.toMatch(CJK);
    await i18n.changeLanguage("zh");
    expect(formatRelativeTime(daysAgo(30))).not.toMatch(/[A-Za-z]/);
  });

  it("源码守卫：`formatRelativeTime` 内不再有中文文案、不再写死 `zh-CN`", () => {
    const src = readFileSync(join(__dirname, "..", "format.ts"), "utf-8");
    const start = src.indexOf("export function formatRelativeTime");
    expect(start).toBeGreaterThan(-1);
    // 用**花括号配平**取到函数体（初版按"下一个 export"切片 ⇒ 后面没有 export 时
    // 会切到整个文件尾部，把别的函数/注释里的中文误判为命中）
    const open = src.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    expect(end).toBeGreaterThan(open);
    const body = src.slice(start, end);

    expect(body).not.toMatch(CJK);
    expect(body).not.toContain('"zh-CN"');
    expect(body).toContain("currentLocale()");
    expect(body).toContain('i18n.t("common.timeYesterday")');
  });
});
