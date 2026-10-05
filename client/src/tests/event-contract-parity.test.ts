// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 跨端事件契约守卫（client 侧）—— 2026-10-05 P1-18 / L5
 *
 * 姐妹门禁：`app/tests/chat/eventTypeParity.test.ts`（shared ⟷ 两端载荷顶层键 + 载荷
 * **字段级**编译期校验）。本文件补 **client 侧**运行期守卫，锁三件事：
 *   ① shared 事件名单 `LIRI_EVENT_NAMES` 的**运行时**内容（含曾因正则口径漏掉的连字符名）；
 *   ② client 载荷映射顶层键 ≡ shared 名单（客户端视图：漏名 / 自增名即失败）；
 *   ③ 目标域 4 词表**单一事实源**：client 不再内联重定义（防回退到手写镜像，L4）。
 * 末组为**证伪**用例：向校验逻辑喂"篡改输入"，必须被判为不一致（证明校验本身有效）。
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { LIRI_EVENT_NAMES } from "@shared/events/eventNames";
import type { LiriEventName } from "@shared/events/eventNames";
import type { LiriEventMap } from "../types/events";

const HERE = dirname(fileURLToPath(import.meta.url));
/** 前端事件文件（事件名联合 + 载荷映射同文件） */
const CLIENT_EVENTS_FILE = join(HERE, "../types/events.ts");

/** 提取「载荷映射顶层键」（行首 2 空格缩进的 `'a/b': {` 或 `"a/b": {`） */
function extractPayloadKeys(filePath: string): Set<string> {
  const keys = new Set<string>();
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = /^ {2}['"]([a-z][a-z0-9_/-]*)['"]\s*:/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** 事件名单集合（供集合运算） */
function nameSet(): Set<string> {
  return new Set<string>(LIRI_EVENT_NAMES);
}

/**
 * **编译期**守卫（tsc 可捕获）：client 载荷不得声明 shared 名单之外的事件名。
 * 若有人只在 client 增删一个顶层键 ⇒ 下方断言报错。
 */
type AssertNever<T extends never> = T;
type ClientExtraEventKeys = Exclude<keyof LiriEventMap, LiriEventName>;
export type _NoClientOnlyEventKey = AssertNever<ClientExtraEventKeys>;

describe("shared 事件名单 LIRI_EVENT_NAMES（运行时约束）", () => {
  test("包含连字符名（42/44 口径缺口的回归守卫）", () => {
    expect(LIRI_EVENT_NAMES).toContain("assistant/text-batch");
    expect(LIRI_EVENT_NAMES).toContain("context/model-input");
  });

  test("包含曾漂移的 goal/* 与 agent/recovery（D-1 回归守卫）", () => {
    const drifted = [
      "goal/created",
      "goal/updated",
      "goal/status_changed",
      "goal/injected",
      "goal/deviation",
      "agent/recovery",
    ];
    for (const name of drifted) {
      expect(LIRI_EVENT_NAMES).toContain(name);
    }
  });

  test("无重复且数量足量（防静默截断）", () => {
    expect(new Set(LIRI_EVENT_NAMES).size).toBe(LIRI_EVENT_NAMES.length);
    expect(LIRI_EVENT_NAMES.length).toBeGreaterThan(30);
  });
});

describe("client 载荷映射顶层键 ≡ shared 名单", () => {
  const shared = nameSet();
  const clientKeys = extractPayloadKeys(CLIENT_EVENTS_FILE);

  test("两处均提取到足量事件名（防空跑假绿）", () => {
    expect(shared.size).toBeGreaterThan(30);
    expect(clientKeys.size).toBeGreaterThan(30);
  });

  test("client 不漏 shared 的任何事件名", () => {
    const missing = [...shared].filter((n) => !clientKeys.has(n)).sort();
    expect(missing, `client 载荷漏了：${missing.join(", ")}`).toEqual([]);
  });

  test("client 不得出现 shared 名单之外的事件名", () => {
    const extra = [...clientKeys].filter((n) => !shared.has(n)).sort();
    expect(extra, `client 多出：${extra.join(", ")}`).toEqual([]);
  });
});

describe("目标域 4 词表单一事实源（L4 下沉后一致性）", () => {
  const clientSrc = readFileSync(CLIENT_EVENTS_FILE, "utf8");

  test("client 不再内联重定义 4 个联合（防回退到手写镜像）", () => {
    for (const typeName of [
      "TaskGoalStatus",
      "TaskGoalUpdateReason",
      "GoalTemplateKind",
      "GoalDeviationSeverity",
    ]) {
      expect(clientSrc).not.toContain(`export type ${typeName} =`);
    }
  });

  test("client 从 shared 单一事实源引用这 4 个联合", () => {
    expect(clientSrc).toContain('from "@shared/types/goal-types"');
  });
});

describe("证伪：校验逻辑对篡改输入必须判不一致", () => {
  test("篡改 client 键集合 ⇒ 漏名 / 多出必然被判定", () => {
    const shared = nameSet();
    const clientKeys = extractPayloadKeys(CLIENT_EVENTS_FILE);

    // 对照：真实数据一致（无漏、无多）
    expect([...shared].filter((n) => !clientKeys.has(n))).toEqual([]);
    expect([...clientKeys].filter((n) => !shared.has(n))).toEqual([]);

    // 证伪 A：移除一个真实成员 ⇒ 必然报「漏名」
    const removed = new Set(clientKeys);
    removed.delete("goal/created");
    expect([...shared].filter((n) => !removed.has(n))).toEqual([
      "goal/created",
    ]);

    // 证伪 B：新增一个 shared 之外的名字 ⇒ 必然报「多出」
    const added = new Set([...clientKeys, "bogus/event"]);
    expect([...added].filter((n) => !shared.has(n))).toEqual(["bogus/event"]);
  });
});
