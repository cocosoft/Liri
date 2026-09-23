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
 * JsonTree 组件测试（P2-3，2026-09-22）
 *
 * 锁定：默认展开深度、折叠交互、数组/对象预览、原始值渲染、**超长字符串截断**。
 * 该组件无文案（不含 i18n），故不依赖翻译基座。
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JsonTree } from "../components/common/JsonTree";

describe("JsonTree（P2-3）", () => {
  it("默认展开根一层 ⇒ 显示一级 key 与值", () => {
    render(<JsonTree value={{ a: 1, b: "x" }} />);
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText(/"x"/)).toBeTruthy(); // 字符串带引号渲染
  });

  it("深层默认折叠 ⇒ 嵌套对象的键不出现", () => {
    render(<JsonTree value={{ outer: { inner: 42 } }} />);
    expect(screen.getByText("outer")).toBeTruthy();
    // 关键断言：深层未展开 ⇒ `inner` 不在文档中
    expect(screen.queryByText("inner")).toBeNull();
  });

  it("defaultDepth=2 ⇒ 二层展开", () => {
    render(<JsonTree value={{ outer: { inner: 42 } }} defaultDepth={2} />);
    expect(screen.getByText("inner")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("点击按钮可折叠（收起后子项消失）", () => {
    render(<JsonTree value={{ a: 1 }} />);
    const toggle = screen.getByRole("button", { expanded: true });
    expect(screen.getByText("a")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText("a")).toBeNull();
    // 折叠后 aria-expanded 翻转为 false
    expect(screen.getByRole("button", { expanded: false })).toBeTruthy();
  });

  it("数组 ⇒ Array(n) 预览 + 数字索引键", () => {
    render(<JsonTree value={[10, 20]} />);
    expect(screen.getByText("Array(2)")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
  });

  it("原始值：null / boolean / number 原样渲染", () => {
    render(<JsonTree value={{ n: null, b: true, i: 7 }} />);
    expect(screen.getByText("null")).toBeTruthy();
    expect(screen.getByText("true")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("超长字符串 ⇒ 截断渲染并标注总长（避免整段撑爆）", () => {
    const long = "x".repeat(2500);
    render(<JsonTree value={{ s: long }} />);
    expect(screen.getByText(/共 2500 字符/)).toBeTruthy();
    // 截断：渲染文本长度应远小于原文
    const rendered = screen.getByText(/共 2500 字符/);
    expect((rendered.textContent ?? "").length).toBeLessThan(2500);
  });

  it("undefined 值可渲染（不抛错）", () => {
    render(<JsonTree value={{ u: undefined }} />);
    expect(screen.getByText("undefined")).toBeTruthy();
  });
});
