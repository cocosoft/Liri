/**
 * TableBlock —— markdown 表格渲染组件
 *
 * 解析 GFM 表格格式，支持标题行、分隔符对齐和行交替背景色。
 * 从 MarkdownRenderer.tsx 提取，保持原逻辑不变。
 */
interface TableBlockProps {
  content: string;
  renderText: (text: string, autoDetectFormula?: boolean) => JSX.Element[];
}

function TableBlock({ content, renderText }: TableBlockProps) {
  const rows = content.split("\n");
  if (rows.length < 2) return null;

  const headers = rows[0].split("|").filter((cell) => cell.trim());
  const separator = rows[1];
  const dataRows = rows.slice(2);

  const alignments = separator
    .split("|")
    .filter((cell) => cell.trim())
    .map((cell) => {
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
          const cells = row.split("|").filter((cell) => cell.trim());
          return (
            <tr
              key={rowIdx}
              className={
                rowIdx % 2 === 0
                  ? "bg-white dark:bg-gray-800"
                  : "bg-gray-50 dark:bg-gray-750"
              }
            >
              {cells.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="border border-gray-300 dark:border-gray-600 px-4 py-2"
                  style={{ textAlign: alignments[cellIdx] }}
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
