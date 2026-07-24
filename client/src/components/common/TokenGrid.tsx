// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * TokenGrid — 4 列 Token 明细网格（场景 A，用于 CostPage）
 * 替换 CostPage.tsx L285-342 的 ~60 行重复 JSX。
 * Props: { inputTokens, outputTokens, cacheReadTokens, totalRequests }
 */
import { formatTokens } from "../../utils/format";

export interface TokenGridProps {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalRequests: number;
}

export function TokenGrid({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  totalRequests,
}: TokenGridProps) {
  const cards: { label: string; value: string }[] = [
    { label: "累计输入 Tokens", value: formatTokens(inputTokens) },
    { label: "累计输出 Tokens", value: formatTokens(outputTokens) },
    { label: "缓存读取 Tokens", value: formatTokens(cacheReadTokens) },
    { label: "总请求数", value: totalRequests.toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {card.label}
          </p>
          <p className="text-xl font-bold mt-1 text-gray-900 dark:text-gray-100">
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
