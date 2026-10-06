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
 * i18n 键对齐守卫（N-74 根因修复，2026-10-06）
 *
 * **背景**：`en.ts` 曾缺 **96 个** zh 已有键（`common.reset` / `office.mailSend` /
 * `image.cropX` / `logs.autoRefresh` …）⇒ 英文界面渲染**原始键名**或中文兜底，
 * 而**此前无任何机制**能在新增 zh 键时发现漏补（N-74 当初只记录了 3 个键，
 * 全量键对照后才发现真实规模是 96）。
 *
 * **本用例的作用**：把「zh/en 叶子键集合完全一致」变为**机械判据**（漂移即失败），
 * 对照仓内既有漂移门手法（`promptSectionLayersGate.test.ts` / `eventTypeParity.test.ts`）。
 */
import { describe, expect, test } from "vitest";
import zh from "../i18n/locales/zh";
import en from "../i18n/locales/en";

/** 递归收集叶子键与值（数组与字符串视为叶子） */
function collectLeaves(node: unknown, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  if (Array.isArray(node)) return [[prefix, node.map(String).join("|")]];
  if (node !== null && typeof node === "object") {
    const out: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      out.push(...collectLeaves(value, prefix ? `${prefix}.${key}` : key));
    }
    return out;
  }
  return [[prefix, String(node)]];
}

const zhLeaves = collectLeaves(zh);
const enLeaves = collectLeaves(en);

describe("i18n 键对齐（zh ↔ en）", () => {
  test("两侧叶子键集合完全一致（无缺键、无多余键）", () => {
    const zhKeys = zhLeaves.map(([key]) => key).sort();
    const enKeys = enLeaves.map(([key]) => key).sort();

    // 报错信息给出差集，便于直接定位（缺键 / 多余键）
    const missingInEn = zhKeys.filter((key) => !enKeys.includes(key));
    const missingInZh = enKeys.filter((key) => !zhKeys.includes(key));
    expect({ missingInEn, missingInZh }).toEqual({
      missingInEn: [],
      missingInZh: [],
    });
  });

  // 注：**不**断言"无空值键" —— `office.templatesUnit` 的 `en` 值为 `""` 是**有意**的
  // （英文数字后无需量词，zh 为「个」）。若要收紧该约束，须先裁定其语义，不得据此判缺陷。

  test("N-74 回归锁：曾整批缺失的代表键现已存在", () => {
    const enKeys = new Set(enLeaves.map(([key]) => key));
    for (const key of [
      "common.reset",
      "common.yes",
      "common.no",
      "cron.everyNTemplate",
      "image.cropX",
      "logs.autoRefresh",
      "office.mailSend",
      "office.calAdd",
      "office.docCreateDocx",
      "office.close",
      "office.saveFailed",
    ]) {
      expect(enKeys.has(key), `en 缺键：${key}`).toBe(true);
    }
  });
});
