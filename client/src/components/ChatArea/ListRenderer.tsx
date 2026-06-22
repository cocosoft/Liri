/**
 * ListRenderer —— markdown 列表渲染组件
 *
 * 支持有序列表、无序列表和 GFM 任务列表（含 checkbox）。
 * 从 MarkdownRenderer.tsx 提取，保持原逻辑不变。
 */
interface ListRendererProps {
  content: string;
  renderText: (text: string, autoDetectFormula?: boolean) => JSX.Element[];
}

function ListRenderer({ content, renderText }: ListRendererProps) {
  const lines = content.split("\n");
  const isOrdered = lines[0].match(/^\d+\.\s/) !== null;
  const isTaskList = !isOrdered && lines.some((l) => /^\s*[-*+]\s+\[[ x]\]/.test(l));
  const items: JSX.Element[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // GFM 任务列表: - [ ] 或 - [x]
    const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ x])\]\s*(.*)/);
    if (taskMatch) {
      const checked = taskMatch[2] === "x";
      const indent = taskMatch[1].length;
      items.push(
        <li key={idx} className="flex items-center gap-2 my-1" style={{ marginLeft: `${indent * 0.5}rem`, listStyle: "none" }}>
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-500 focus:ring-blue-500 cursor-default"
          />
          <span className={checked ? "line-through text-gray-400 dark:text-gray-500" : ""}>
            {renderText(taskMatch[3])}
          </span>
        </li>
      );
      return;
    }

    let itemContent = "";

    if (line.startsWith("  ")) {
      itemContent = line.trim();
    } else {
      itemContent = line.replace(/^[-*+]\s/, "").replace(/^\d+\.\s/, "");
    }

    items.push(
      <li key={idx} className="ml-4 my-1">
        {renderText(itemContent)}
      </li>
    );
  });

  if (isOrdered) {
    return <ol key="list" className="my-2 list-decimal">{items}</ol>;
  }
  if (isTaskList) {
    return <ul key="list" className="my-2" style={{ listStyle: "none", paddingLeft: 0 }}>{items}</ul>;
  }
  return <ul key="list" className="my-2 list-disc">{items}</ul>;
}

export default ListRenderer;
