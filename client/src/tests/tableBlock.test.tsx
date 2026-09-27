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
 * TableBlock — GFM 表格列对齐守卫（2026-09-27，P0-5）
 *
 * 原缺陷：`splitCells` 用 `.filter(cell => cell.trim())` 丢弃**所有**空单元格
 * ⇒ `| a |  | c |` 只解析出 2 格 ⇒ 表格列错位、内容串列。
 * 本守卫锁：空单元格保留、行按表头列数补齐、`\|` 转义不被误分割。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import TableBlock from "../components/ChatArea/TableBlock";

const renderText = (text: string) => [<span key="t">{text}</span>];

describe("TableBlock（P0-5）", () => {
  it("中间空单元格保留 ⇒ 表头 3 列、每行 3 个单元格", () => {
    const content = [
      "| a |  | c |",
      "| :-- | :-: | --: |",
      "| 1 |  | 3 |",
    ].join("\n");
    render(<TableBlock content={content} renderText={renderText} />);

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(3);
    expect(headers[0].textContent).toBe("a");
    expect(headers[1].textContent).toBe("");
    expect(headers[2].textContent).toBe("c");

    const cells = screen.getAllByRole("cell");
    expect(cells).toHaveLength(3);
    expect(cells[0].textContent).toBe("1");
    expect(cells[1].textContent).toBe("");
    expect(cells[2].textContent).toBe("3");
  });

  it("转义竖线 \\| 不被当作列分隔符", () => {
    const content = ["| a | b |", "| --- | --- |", "| x \\| y | z |"].join(
      "\n",
    );
    render(<TableBlock content={content} renderText={renderText} />);
    const cells = screen.getAllByRole("cell");
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe("x | y");
    expect(cells[1].textContent).toBe("z");
  });

  it("数据行少列 ⇒ 按表头列数补齐（不串列）", () => {
    const content = ["| a | b | c |", "| --- | --- | --- |", "| 1 |"].join(
      "\n",
    );
    render(<TableBlock content={content} renderText={renderText} />);
    const cells = screen.getAllByRole("cell");
    expect(cells).toHaveLength(3);
    expect(cells[1].textContent).toBe("");
    expect(cells[2].textContent).toBe("");
  });
});
