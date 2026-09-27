/**
 * TableBlock —— markdown 表格渲染组件
 *
 * 解析 GFM 表格格式，支持标题行、分隔符对齐和行交替背景色。
 * 从 MarkdownRenderer.tsx 提取，保持原逻辑不变。
 */

import type { JSX } from "react";

/** 转义竖线占位符：分割前保护单元格内 `\|`，避免被误分割为多个单元格 */
const ESCAPED_PIPE = "\u0000";

/** 分割表格行为单元格：先占位 `\|` → 按 `|` 分割 → 还原转义竖线 */
function splitCells(line: string): string[] {
  const cells = line
    .replace(/\\\|/g, ESCAPED_PIPE)
    .split("|")
    .map((cell) => cell.replace(/\u0000/g, "|"));
  // GFM：首尾管道可选 ⇒ 只剥掉**边界**上的空串；中间的空单元格必须保留
  // （2026-09-27 修复 P0-5：原实现 `.filter(cell => cell.trim())` 丢弃所有空单元格，
  //  导致 `| a |  | c |` 变成 2 格 ⇒ 表格列错位、内容串列）
  if (cells.length > 0 && cells[0].trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells;
}

interface TableBlockProps {
  content: string;
  renderText: (text: string, autoDetectFormula?: boolean) => JSX.Element[];
}

function TableBlock({ content, renderText }: TableBlockProps) {
  const rows = content.split("\n");
  if (rows.length < 2) return null;

  const headers = splitCells(rows[0]);
  const separator = rows[1];
  const dataRows = rows.slice(2);

  const alignments = splitCells(separator).map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center" as const;
    if (cell.startsWith(":")) return "left" as const;
    if (cell.endsWith(":")) return "right" as const;
    return "left" as const;
  });

  return (
    <table className="w-full border-collapse my-4">
      <thead>
        <tr className="bg-gray-100 dark:bg-gray-700">
          {headers.map((header, idx) => (
            <th
              key={idx}
              className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left"
              style={{ textAlign: alignments[idx] }}
            >
              <span>{renderText(header.trim())}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataRows.map((row, rowIdx) => {
          const rawCells = splitCells(row);
          // P0-5 配套：按表头列数补齐，保证各行栅格一致（空单元格保留后仍需对齐列宽）
          const cells = headers.map((_, i) => rawCells[i] ?? "");
          return (
            <tr
              key={rowIdx}
              className={
                rowIdx % 2 === 0
                  ? "bg-white dark:bg-gray-800"
                  : "bg-gray-50 dark:bg-gray-900"
              }
            >
              {cells.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="border border-gray-300 dark:border-gray-600 px-4 py-2"
                  style={{ textAlign: alignments[cellIdx] ?? "left" }}
                >
                  <span>{renderText(cell.trim())}</span>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default TableBlock;
