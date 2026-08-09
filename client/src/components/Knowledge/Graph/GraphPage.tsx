import { useState, useEffect, useMemo, useCallback } from "react";
import { graphService } from "../../../services/graphService";
import type { GraphEdge, GraphStats } from "../../../types/project";
import { GraphFilterPanel } from "./GraphFilterPanel";
import { GraphNodeDetail } from "./GraphNodeDetail";
import { GraphCanvas } from "./GraphCanvas";
import { RefreshCw } from "lucide-react";

interface GraphPageProps {
  isDark: boolean;
}

export function GraphPage({ isDark }: GraphPageProps) {
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await graphService.listEdges({
        domain: selectedDomain || undefined,
        type: selectedType || undefined,
        limit: 500,
      });
      setEdges(data.edges);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [selectedDomain, selectedType]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredEdges = useMemo(() => {
    let result = edges;
    if (selectedType) result = result.filter((e) => e.type === selectedType);
    if (selectedDomain)
      result = result.filter((e) => e.domain === selectedDomain);
    return result;
  }, [edges, selectedType, selectedDomain]);

  const focusEdges = useMemo(() => {
    if (!focusNode) return [];
    return edges.filter((e) => e.from === focusNode || e.to === focusNode);
  }, [edges, focusNode]);

  return (
    <div className="flex h-full">
      {/* 左侧面板：统计 + 过滤 */}
      <div
        className={`w-48 shrink-0 p-3 border-r overflow-y-auto ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <GraphFilterPanel
          stats={stats}
          selectedType={selectedType}
          selectedDomain={selectedDomain}
          onSelectType={setSelectedType}
          onSelectDomain={setSelectedDomain}
          isDark={isDark}
        />
      </div>

      {/* 中间：SVG 图谱 + 边列表 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div
          className={`flex items-center justify-between px-4 py-2 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <span
            className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {filteredEdges.length} 条边
            {focusNode && (
              <span className="ml-1 text-blue-400">
                | 聚焦: {focusNode.slice(0, 30)}
              </span>
            )}
          </span>
          <button
            onClick={load}
            disabled={loading}
            className={`p-1 rounded transition-colors ${isDark ? "text-gray-400 hover:text-gray-200 hover:bg-gray-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {error && (
          <div className="text-xs text-red-500 px-4 py-2 bg-red-500/10">
            {error}
          </div>
        )}

        {/* SVG 图谱画布 */}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-500">
              加载中...
            </div>
          ) : edges.length === 0 ? (
            <div
              className={`flex items-center justify-center h-full text-sm ${isDark ? "text-gray-600" : "text-gray-400"}`}
            >
              暂无图谱数据。编译知识库后自动生成。
            </div>
          ) : (
            <GraphCanvas
              edges={filteredEdges.slice(0, 200)}
              focusNode={focusNode ?? undefined}
              onFocusNode={setFocusNode}
              isDark={isDark}
            />
          )}
        </div>
      </div>

      {/* 右侧：节点详情面板 */}
      {focusNode && (
        <div
          className={`w-56 shrink-0 p-3 border-l overflow-y-auto ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <GraphNodeDetail
            edges={focusEdges}
            focusNode={focusNode}
            isDark={isDark}
            onClear={() => setFocusNode(null)}
          />
        </div>
      )}
    </div>
  );
}
