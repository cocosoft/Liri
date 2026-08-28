import { useState, useEffect, useMemo, useCallback } from "react";
import { graphService } from "../../../services/graphService";
import type { GraphEdge, GraphStats } from "../../../types/project";
import { GraphFilterPanel } from "./GraphFilterPanel";
import { GraphNodeDetail } from "./GraphNodeDetail";
import { GraphCanvas } from "./GraphCanvas";
import { RefreshCw } from "lucide-react";

interface GraphPageProps {
  isDark: boolean;
  /** KB-C1：当前是否为激活 tab —— 切回图谱 tab 时重新加载（编译知识库后数据同步） */
  active?: boolean;
}

export function GraphPage({ isDark, active = true }: GraphPageProps) {
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
    // KB-C1：active 变 true（切回本 tab / 首次挂载）时加载，确保编译后的最新图谱可见
    if (active) load();
  }, [load, active]);

  const filteredEdges = useMemo(() => {
    let result = edges;
    if (selectedType) result = result.filter((e) => e.type === selectedType);
    if (selectedDomain)
      result = result.filter((e) => e.domain === selectedDomain);
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (e) =>
          e.from.toLowerCase().includes(q) ||
          e.to.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q),
      );
    }
    return result;
  }, [edges, selectedType, selectedDomain, search]);

  const matchedEntities = useMemo(() => {
    const set = new Set<string>();
    for (const e of filteredEdges) {
      set.add(e.from);
      set.add(e.to);
    }
    return set.size;
  }, [filteredEdges]);

  const matchedTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of filteredEdges) set.add(e.type);
    return set.size;
  }, [filteredEdges]);

  const focusEdges = useMemo(() => {
    if (!focusNode) return [];
    return edges.filter((e) => e.from === focusNode || e.to === focusNode);
  }, [edges, focusNode]);

  return (
    <div className="flex h-full w-full">
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
          className={`flex items-center gap-3 px-4 py-2 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索实体名 / 关系类型…"
            className={`w-44 px-2 py-1 text-xs rounded border outline-none focus:ring-1 ${
              isDark
                ? "bg-gray-800 border-gray-700 text-gray-200 placeholder-gray-500 focus:ring-blue-500"
                : "bg-white border-gray-300 text-gray-700 placeholder-gray-400 focus:ring-blue-400"
            }`}
          />
          <span
            className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {filteredEdges.length} 条边
            {/* KB-C13：画布仅渲染前 200 条，超限明确提示避免计数与渲染不符 */}
            {filteredEdges.length > 200 && (
              <span className="ml-1 text-amber-500 dark:text-amber-400">
                （画布仅显示前 200 条）
              </span>
            )}
            {search && (
              <span className="ml-1 text-blue-400">
                | 匹配 {matchedEntities} 个实体 · {matchedTypes} 种关系
              </span>
            )}
            {focusNode && (
              <span className="ml-1 text-blue-400">
                | 聚焦: {focusNode.slice(0, 30)}
              </span>
            )}
          </span>
          <button
            onClick={load}
            disabled={loading}
            className={`ml-auto p-1 rounded transition-colors ${isDark ? "text-gray-400 hover:text-gray-200 hover:bg-gray-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
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
          ) : filteredEdges.length === 0 ? (
            <div
              className={`flex items-center justify-center h-full text-sm ${isDark ? "text-gray-600" : "text-gray-400"}`}
            >
              无匹配结果，换个关键词试试。
            </div>
          ) : (
            <GraphCanvas
              edges={filteredEdges.slice(0, 200)}
              focusNode={focusNode ?? undefined}
              onFocusNode={setFocusNode}
              isDark={isDark}
              highlight={search}
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
