import { memo } from "react";
import type { GraphStats } from "../../../types/graph";

interface GraphFilterPanelProps {
  stats: GraphStats | null;
  selectedType: string;
  selectedDomain: string;
  onSelectType: (t: string) => void;
  onSelectDomain: (d: string) => void;
  isDark: boolean;
}

const TYPE_COLORS = [
  "bg-blue-500/20 text-blue-400",
  "bg-purple-500/20 text-purple-400",
  "bg-emerald-500/20 text-emerald-400",
  "bg-amber-500/20 text-amber-400",
  "bg-pink-500/20 text-pink-400",
  "bg-cyan-500/20 text-cyan-400",
  "bg-red-500/20 text-red-400",
  "bg-indigo-500/20 text-indigo-400",
];

export const GraphFilterPanel = memo(function GraphFilterPanel({
  stats,
  selectedType,
  onSelectType,
  isDark,
}: GraphFilterPanelProps) {
  const types = stats?.byType ? Object.entries(stats.byType) : [];

  return (
    <div className="space-y-3">
      {stats && (
        <div className={`text-xs grid grid-cols-3 gap-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
          <div className={`text-center px-2 py-1.5 rounded ${isDark ? "bg-gray-800" : "bg-gray-100"}`}>
            <div className="text-sm font-semibold">{stats.totalEdges}</div>
            <div className="text-[10px]">边</div>
          </div>
          <div className={`text-center px-2 py-1.5 rounded ${isDark ? "bg-gray-800" : "bg-gray-100"}`}>
            <div className="text-sm font-semibold">{stats.totalEntities}</div>
            <div className="text-[10px]">实体</div>
          </div>
          <div className={`text-center px-2 py-1.5 rounded ${isDark ? "bg-gray-800" : "bg-gray-100"}`}>
            <div className="text-sm font-semibold">{Object.keys(stats.byType).length}</div>
            <div className="text-[10px]">关系类型</div>
          </div>
        </div>
      )}

      <div>
        <span className={`text-[10px] font-medium ${isDark ? "text-gray-500" : "text-gray-400"}`}>
          关系类型
        </span>
        <div className="flex flex-wrap gap-1 mt-1">
          <button
            onClick={() => onSelectType("")}
            className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
              selectedType === ""
                ? "bg-blue-500/30 text-blue-400"
                : isDark ? "bg-gray-800 text-gray-400 hover:bg-gray-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            全部
          </button>
          {types.map(([type, count], i) => (
            <button
              key={type}
              onClick={() => onSelectType(type)}
              className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
                selectedType === type
                  ? TYPE_COLORS[i % TYPE_COLORS.length] + " ring-1 ring-offset-0"
                  : isDark ? "bg-gray-800 text-gray-400 hover:bg-gray-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {type} ({count})
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
