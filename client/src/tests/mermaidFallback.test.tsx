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
 * Mermaid 降级守卫（P1-1①，2026-09-28）
 *
 * 原缺陷：`mermaid.render()` 失败时，mermaid 会自行往 DOM 注入它的错误图
 * （"Syntax error in text mermaid version …"，即用户截图右下角红字）；原 catch 只替换
 * 目标元素，**拦不住该注入**，且降级把源码渲染成红字（第二个红字来源）。
 *
 * 本守卫锁定两条不变量：
 *   ① 语法非法 ⇒ **只走 `parse` 预校验、绝不调用 `render`**（从根上杜绝错误图进入 DOM）；
 *   ② 降级 UI ＝ 通俗提示（i18n `chat.mermaidRenderFailed`）+ 原样保留源码（可复制）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MarkdownRenderer from "../components/ChatArea/MarkdownRenderer";

const { parseMock, renderMock } = vi.hoisted(() => ({
  parseMock: vi.fn(),
  renderMock: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: (code: string) => parseMock(code),
    render: (id: string, code: string) => renderMock(id, code),
  },
}));

const BAD_DIAGRAM = "```mermaid\ngraph TD;\nA-->;\n```";
const GOOD_DIAGRAM = "```mermaid\ngraph TD;\nA-->B;\n```";

describe("Mermaid 降级（P1-1①）", () => {
  it("语法非法 ⇒ 只 parse 不 render（不注入错误图）+ 通俗提示 + 源码保留", async () => {
    parseMock.mockImplementation(async (code: string) => {
      if (code.includes("A-->;")) throw new Error("Parse error on line 1");
      return true;
    });

    render(<MarkdownRenderer content={BAD_DIAGRAM} />);

    await waitFor(() => expect(parseMock).toHaveBeenCalled());
    // 核心不变量：parse 已拦下 ⇒ render 从未被调用（mermaid 无机会注入错误图）
    expect(renderMock).not.toHaveBeenCalled();
    expect(document.body.textContent ?? "").not.toMatch(
      /Syntax error in text mermaid/i,
    );
    expect(
      screen.getByText("图表未能渲染（语法有误），已保留源码"),
    ).toBeTruthy();
    // 源码原样保留（可复制）
    expect(document.body.textContent ?? "").toContain("A-->;");
  });

  it("语法合法 ⇒ 正常渲染（阳性对照）", async () => {
    parseMock.mockResolvedValue(true);
    renderMock.mockResolvedValue({ svg: "<svg><title>ok</title></svg>" });

    render(<MarkdownRenderer content={GOOD_DIAGRAM} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(document.querySelector(".mermaid.rendered")).toBeTruthy(),
    );
    expect(document.body.textContent ?? "").not.toContain("图表未能渲染");
  });
});
