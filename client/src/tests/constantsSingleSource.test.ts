/**
 * HD-P2-3 守卫：前端**自定义事件名**与**跨文件存储键**必须**单点定义**。
 *
 * **为什么值得守卫**：事件名由「一处 `dispatchEvent` + 他处 `addEventListener`」成对使用，
 * 字面量漂移 ⇒ **监听方静默不触发**（无编译期报错、无运行时报错）；存储键漂移 ⇒
 * 既有用户本地数据"丢失"。两者都属"错了也不报错"的缺陷 ⇒ 用源码守卫把口径钉死。
 *
 * **口径**：带引号的字面量只允许出现在对应真源文件；**排除注释行**（行首 `//` / `*` / `/*`，
 * 注释里提到事件名是正常叙述）与测试文件。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "vitest";

import { APP_EVENTS } from "../constants/events";
import { STORAGE_KEYS } from "../constants/storage";

const SRC = join(__dirname, "..");
const EVENTS_FILE = "constants/events.ts";
const STORAGE_FILE = "constants/storage.ts";

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

const ALL_FILES: string[] = [];
collect(SRC, ALL_FILES);

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** 返回 `字面量` 在「真源之外」的命中点（`文件:行`）；注释行与测试文件不计。 */
function scanLiteral(literal: string, exceptRel: string): string[] {
  const needle = `"${literal}"`;
  const hits: string[] = [];
  for (const p of ALL_FILES) {
    const rel = relative(SRC, p).split("\\").join("/");
    if (rel === exceptRel) continue;
    if (rel.includes("__tests__") || /\.test\.(ts|tsx)$/.test(rel)) continue;
    const lines = readFileSync(p, "utf-8").split("\n");
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      if (line.includes(needle)) hits.push(`${rel}:${i + 1}`);
    });
  }
  return hits;
}

describe("HD-P2-3 · 事件名 / 存储键单一真源", () => {
  test("自定义事件名的字面量只出现在 constants/events.ts", () => {
    const offenders = Object.values(APP_EVENTS).flatMap((name) =>
      scanLiteral(name, EVENTS_FILE),
    );
    expect(
      offenders,
      "应引用 APP_EVENTS.*（散落字面量 ⇒ 监听方静默不触发）",
    ).toEqual([]);
  });

  test("鉴权令牌键的字面量只出现在 constants/storage.ts", () => {
    expect(
      scanLiteral(STORAGE_KEYS.authToken, STORAGE_FILE),
      "应引用 STORAGE_KEYS.authToken（改名或写错 ⇒ 既有用户被判定为未登录）",
    ).toEqual([]);
  });
});
