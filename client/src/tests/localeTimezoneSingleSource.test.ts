/**
 * HD-P1-2 **A9** 守卫：客户端**语言 / 时区**单一真源。
 *
 * **背景（方案 §2.5）**：默认语言/时区原先**自相矛盾**（后端 `en-US`/`UTC` vs `LanguageManager` 的 `zh-CN`）。
 * **裁定（`Q-H2`）**：统一为 **`zh-CN` / `Asia/Shanghai`**。**A9 客户端片**把**绕过配置**的写死点接回真源：
 * - 界面日期/数字格式化 ⇒ `client/src/utils/format.ts` 的 **`currentLocale()`**（随 UI 语言切换）；
 * - 产品默认语言 / 时区兜底 ⇒ `client/src/constants/locale.ts` 的 **`DEFAULT_LOCALE` / `DEFAULT_TIMEZONE`**。
 *
 * **本守卫口径**：`client/src` 内**不得**再出现
 * ① `toLocale*("zh-CN"…)`（应按语言取 locale）；
 * ② 裸 `"Asia/Shanghai"`（**白名单**：真源本体 · 注释 · **数据表**如时区下拉/币种映射）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "vitest";

const SRC = join(__dirname, "..");

/** 允许出现裸 `"Asia/Shanghai"` 的文件（真源本体 / 数据表） */
const TZ_ALLOWLIST: Record<string, string> = {
  "constants/locale.ts": "真源本体（DEFAULT_TIMEZONE）",
  "utils/format.ts": "数据表键（TIMEZONE_CURRENCY_MAP）",
  "components/views/UserPage.tsx": "数据表（TIMEZONES 下拉选项）",
  "components/settings/AppearancePanel.tsx": "数据表（TIMEZONE_OPTIONS 下拉选项）",
};

function collect(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      collect(join(dir, e.name), out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

const ALL: string[] = [];
collect(SRC, ALL);

const rel = (p: string) => relative(SRC, p).split("\\").join("/");

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** 找命中 `模式` 的**代码行**（排除注释行）；返回 `文件:行` */
function codeHits(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const p of ALL) {
    const r = rel(p);
    if (r.includes("__tests__") || /\.test\.(ts|tsx)$/.test(r)) continue;
    readFileSync(p, "utf-8")
      .split("\n")
      .forEach((line, i) => {
        if (isCommentLine(line)) return;
        if (pattern.test(line)) hits.push(`${r}:${i + 1}`);
      });
  }
  return hits;
}

describe("HD-P1-2 A9 · 客户端语言/时区单一真源", () => {
  test('不得再写死 `toLocale*("zh-CN")`（应按语言取 locale）', () => {
    expect(
      codeHits(/toLocale[A-Za-z]*\(\s*["']zh-CN["']/),
      "日期/时间格式化应引用 utils/format.ts 的 currentLocale()",
    ).toEqual([]);
  });

  test('裸 `"Asia/Shanghai"` 只允许出现在真源与数据表白名单', () => {
    const offenders = codeHits(/["']Asia\/Shanghai["']/).filter(
      (h) => !(h.split(":")[0] in TZ_ALLOWLIST),
    );
    expect(
      offenders,
      "兜底默认时区应引用 constants/locale.ts 的 DEFAULT_TIMEZONE",
    ).toEqual([]);
  });

  test("真源本身存在且被导出（防被改名/私有化）", () => {
    const locale = readFileSync(join(SRC, "constants", "locale.ts"), "utf-8");
    expect(locale).toMatch(/export const DEFAULT_LOCALE = "zh-CN";/);
    expect(locale).toMatch(/export const DEFAULT_TIMEZONE = "Asia\/Shanghai";/);

    const fmt = readFileSync(join(SRC, "utils", "format.ts"), "utf-8");
    expect(fmt, "currentLocale 必须是 export（否则各组件只能写死）").toMatch(
      /export function currentLocale\(\): string \{/,
    );
  });

  test("消费点确实引用真源（抽样断言）", () => {
    const consumers = [
      "components/ChatArea/ChatMessage.tsx",
      "components/common/Footer.tsx",
      "components/settings/AppearancePanel.tsx",
      "components/views/UsageCenterPage.tsx",
      "components/VoiceInputButton.tsx",
    ];
    for (const f of consumers) {
      const src = readFileSync(join(SRC, f), "utf-8");
      expect(
        src.includes("currentLocale") ||
          src.includes("DEFAULT_TIMEZONE") ||
          src.includes("DEFAULT_LOCALE"),
        `${f} 应引用语言/时区真源`,
      ).toBe(true);
    }
  });
});
