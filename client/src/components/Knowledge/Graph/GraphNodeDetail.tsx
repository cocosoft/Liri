import { memo } from "react";
import type { GraphEdge } from "../../../types/project";

interface GraphNodeDetailProps {
  edges: GraphEdge[];
  focusNode: string;
  isDark: boolean;
  onClear: () => void;
}

export const GraphNodeDetail = memo(function GraphNodeDetail({
  edges,
  focusNode,
  isDark,
  onClear,
}: GraphNodeDetailProps) {
  const outgoing = edges.filter((e) => e.from === focusNode);
  const incoming = edges.filter((e) => e.to === focusNode);

  return (
    <div
      className={`p-3 rounded-lg border ${isDark ? "border-gray-700 bg-gray-800/50" : "border-gray-200 bg-gray-50"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-xs font-mono font-medium truncate max-w-[200px] ${isDark ? "text-blue-400" : "text-blue-600"}`}
        >
          {focusNode}
        </span>
        <button
          onClick={onClear}
          className={`text-[10px] ${isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}
        >
          清除
        </button>
      </div>

      {outgoing.length > 0 && (
        <div className="mb-1.5">
          <span
            className={`text-[10px] font-medium ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            出边 ({outgoing.length})
          </span>
          <div className="space-y-0.5 mt-0.5">
            {outgoing.slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-center gap-1.5 text-[10px]">
                <span
                  className={`px-1 py-0 rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-200 text-gray-600"}`}
                >
                  {e.type}
                </span>
                <span className="text-gray-500">→</span>
                <span
                  className={`truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {e.to}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {incoming.length > 0 && (
        <div>
          <span
            className={`text-[10px] font-medium ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            入边 ({incoming.length})
          </span>
          <div className="space-y-0.5 mt-0.5">
            {incoming.slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-center gap-1.5 text-[10px]">
                <span
                  className={`truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {e.from}
                </span>
                <span className="text-gray-500">→</span>
                <span
                  className={`px-1 py-0 rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-200 text-gray-600"}`}
                >
                  {e.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
