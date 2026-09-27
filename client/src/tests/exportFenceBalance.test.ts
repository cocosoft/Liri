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
 * balanceCodeFences — 导出围栏自愈守卫（2026-09-27，真机产物实证）
 *
 * 事实来源：会话导出 md/html 中，第 8 条消息含**奇数个** ``` ⇒ 其后的 5 个
 * `### 👤/🤖` 角色标题与 `---` 分隔线全被 Markdown 渲染器吞进 `<pre>` 代码块。
 */
import { describe, expect, it } from "vitest";
import { balanceCodeFences } from "../utils/exportMessage";

const countFences = (s: string) => (s.match(/^```/gm) ?? []).length;

describe("balanceCodeFences（导出围栏自愈）", () => {
  it("奇数围栏（未闭合代码块）⇒ 补齐闭合，总数为偶数", () => {
    const odd = "正文\n```python\nprint(1)\n";
    const out = balanceCodeFences(odd);
    expect(countFences(odd) % 2).toBe(1);
    expect(countFences(out) % 2).toBe(0);
    expect(out.startsWith(odd)).toBe(true);
  });

  it("偶数围栏（成对闭合）⇒ 原样返回", () => {
    const even = "正文\n```\na\n```\n尾注";
    expect(balanceCodeFences(even)).toBe(even);
  });

  it("无围栏 ⇒ 原样返回", () => {
    const plain = "普通正文，无代码块。";
    expect(balanceCodeFences(plain)).toBe(plain);
  });

  it("非行首的 ``` 不计入（避免误判行内内容）", () => {
    const inline = "说明：行内写 ``` 不是围栏";
    expect(balanceCodeFences(inline)).toBe(inline);
  });
});
