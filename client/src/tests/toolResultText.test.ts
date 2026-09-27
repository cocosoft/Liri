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
 * toolResultText — 工具结果信封解包 / 解码守卫（2026-09-27，P0-2/P0-3）
 *
 * 事实来源：
 *  - 真机 DOM：工具卡"结果"区显示 `[{"type":"tool_result","value":"…"}]` 信封 JSON；
 *  - 导出产物（`chat-export-*.md/.json`）：信封出现 20+/37 处，且 `value` 为**双重编码**
 *    （`"value":"\"{\\n  \\\"questionId\\\"…}"`）。
 */
import { describe, expect, it } from "vitest";
import {
  decodeToolResultContent,
  unwrapToolResultEnvelope,
} from "../utils/toolResultText";

const envelope = (...values: Array<string | undefined>): string =>
  JSON.stringify(
    values.map((v) => ({
      type: "tool_result",
      ...(v === undefined ? {} : { value: v }),
      toolCallId: "call_x",
    })),
  );

describe("unwrapToolResultEnvelope", () => {
  it("单信封 ⇒ 解出 value", () => {
    expect(unwrapToolResultEnvelope(envelope('{"status":"yielded"}'))).toBe(
      '{"status":"yielded"}',
    );
  });

  it("多信封 ⇒ 按空行顺序拼接", () => {
    expect(unwrapToolResultEnvelope(envelope("A", "B"))).toBe("A\n\nB");
  });

  it("value 非字符串 ⇒ 序列化展示（不丢结果）", () => {
    const raw = JSON.stringify([
      { type: "tool_result", value: { ok: true }, toolCallId: "call_x" },
    ]);
    expect(unwrapToolResultEnvelope(raw)).toContain('"ok": true');
  });

  it("非信封 JSON / 纯文本 / 数组缺 type ⇒ 原样返回", () => {
    for (const raw of [
      '{"ok":true}',
      "File written successfully: a.py",
      '[{"name":"x"}]',
    ]) {
      expect(unwrapToolResultEnvelope(raw)).toBe(raw);
    }
  });
});

describe("decodeToolResultContent", () => {
  it("双重编码 value（导出产物实测形态）⇒ 解码为可读 JSON，无转义噪声", () => {
    const inner = JSON.stringify(
      { questionId: "q_1", answers: ["Python"] },
      null,
      2,
    );
    const out = decodeToolResultContent(envelope(JSON.stringify(inner)));
    expect(out).toBe(inner);
    expect(out).not.toContain('\\"');
    expect(out).not.toContain("tool_result");
  });

  it("单层 JSON 值 ⇒ pretty-print", () => {
    expect(decodeToolResultContent(envelope('{"matches":[],"total":2}'))).toBe(
      '{\n  "matches": [],\n  "total": 2\n}',
    );
  });

  it("空信封（缺 value）⇒ 返回空串（调用方给兜底文案）", () => {
    expect(decodeToolResultContent(envelope(undefined))).toBe("");
  });

  it("纯文本工具输出 ⇒ 原样返回", () => {
    expect(
      decodeToolResultContent("File written successfully: typing.py"),
    ).toBe("File written successfully: typing.py");
  });

  it("形似 JSON 但非法 ⇒ 原样返回（不抛错）", () => {
    expect(decodeToolResultContent("{不是合法 JSON")).toBe("{不是合法 JSON");
  });
});
