import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { graphService } from "../../../services/graphService";
import { schemaService } from "../../../services/schemaService";
import type { GraphEdge, GraphStats } from "../../../types/project";
import { GraphEntitiesPanel } from "./GraphEntitiesPanel";
import { GraphFilterPanel } from "./GraphFilterPanel";
import { GraphNodeDetail } from "./GraphNodeDetail";
import { GraphCanvas } from "./GraphCanvas";
import { GraphEdgeEditor } from "./GraphEdgeEditor";
import { History, Plus, RefreshCw, Upload } from "lucide-react";

interface GraphPageProps {
  isDark: boolean;
  /** KB-C1：当前是否为激活 tab —— 切回图谱 tab 时重新加载（编译知识库后数据同步） */
  active?: boolean;
}

/** 列表请求上限（后端钳制 1..1000） */
const EDGE_FETCH_LIMIT = 1000;
/** 画布渲染上限（cytoscape 性能保护） */
const CANVAS_RENDER_LIMIT = 500;

export function GraphPage({ isDark, active = true }: GraphPageProps) {
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  // B4：编辑抽屉 / 类型白名单 / 操作反馈
  const [editorMode, setEditorMode] = useState<
    "create" | "edit" | "bulk" | "audit" | null
  >(null);
  const [editingEdge, setEditingEdge] = useState<GraphEdge | null>(null);
  // D2-2：实体档案抽屉
  const [entitiesOpen, setEntitiesOpen] = useState(false);
  // D2-3：实体档案名（node_id → name），供画布标签使用
  const [nodeNames, setNodeNames] = useState<Record<string, string>>({});

  const loadNodeNames = useCallback(async () => {
    try {
      const data = await graphService.listNodes({ limit: 1000 });
      const map: Record<string, string> = {};
      for (const node of data.nodes) {
        if (node.name && node.name.trim()) map[node.node_id] = node.name;
      }
      setNodeNames(map);
    } catch {
      // @ignore-catch 档案名是画布标签的增强项，取不到就回退显示 node_id，不阻塞画布
    }
  }, []);

  useEffect(() => {
    void loadNodeNames();
  }, [loadNodeNames]);
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await graphService.listEdges({
        domain: selectedDomain || undefined,
        type: selectedType || undefined,
        // B4：可见性修复 —— 原 limit 500 且画布只渲染 200 条，"看不到就管不了"
        limit: EDGE_FETCH_LIMIT,
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

  // B4：关系类型白名单（constrained → 下拉只用白名单；freeform → 空数组 = 自由输入）
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void schemaService
      .getSchema()
      .then((info) => {
        if (cancelled) return;
        setAllowedTypes(
          info.mode === "constrained" ? info.edges.map((e) => e.type) : [],
        );
      })
      .catch(() => {
        // 白名单读取失败 → 退回自由输入（编辑不被阻断）
        if (!cancelled) setAllowedTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

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

  // P2#13：域过滤入口——由边数据去重（基于未过滤 edges，选域后仍需手动切回"全部"刷新全量域）
  const domainOptions = useMemo(
    () =>
      Array.from(
        new Set(edges.map((e) => e.domain).filter((d): d is string => !!d)),
      ).sort(),
    [edges],
  );

  const focusEdges = useMemo(() => {
    if (!focusNode) return [];
    return edges.filter((e) => e.from === focusNode || e.to === focusNode);
  }, [edges, focusNode]);

  /**
   * B4：画布数据稳定引用
   *
   * `filteredEdges.slice(...)` 每次 render 都产生**新数组**，而 GraphCanvas 的布局
   * effect 依赖 `edges` → 每次父组件重渲染（如打开编辑抽屉、点击节点）都会重跑布局、
   * 节点坐标重新随机化（表现为"节点乱跳、难以点中"）。此处 memo 化避免无谓重排。
   */
  const canvasEdges = useMemo(
    () => filteredEdges.slice(0, CANVAS_RENDER_LIMIT),
    [filteredEdges],
  );

  /** B4：新建关系时的默认域（取当前过滤域，缺省用数据中出现的域，不硬编码） */
  const defaultDomain = useMemo(
    () => selectedDomain || domainOptions[0] || undefined,
    [selectedDomain, domainOptions],
  );

  /** B4：删除实体（连同其全部关系） */
  const handleDeleteEntity = useCallback(
    async (entityId: string) => {
      try {
        const result = await graphService.deleteEntity(entityId);
        showToast(`已删除实体及其 ${result.removedEdges} 条关系`);
        setFocusNode(null);
        void load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除实体失败");
      }
    },
    [showToast, load],
  );

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
          domains={domainOptions}
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
            {/* B4：区分"已加载"与"库中总数"——原口径把拉取条数当总数显示，3042 边时恒显 1000 易误读 */}
            {stats && edges.length < stats.totalEdges ? (
              <>
                已加载 {filteredEdges.length} 条（库中共 {stats.totalEdges} 条）
              </>
            ) : (
              <>{filteredEdges.length} 条边</>
            )}
            {filteredEdges.length > CANVAS_RENDER_LIMIT && (
              <span className="ml-1 text-amber-500 dark:text-amber-400">
                （画布仅显示前 {CANVAS_RENDER_LIMIT} 条）
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
            onClick={() => {
              setEditingEdge(null);
              setEditorMode("create");
            }}
            className={`ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              isDark
                ? "text-gray-300 hover:bg-gray-800"
                : "text-gray-600 hover:bg-gray-100"
            }`}
            title="新增关系（填写新实体 ID 即同时创建该实体）"
          >
            <Plus size={13} />
            新增关系
          </button>
          <button
            onClick={() => {
              setEditingEdge(null);
              setEditorMode("bulk");
            }}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              isDark
                ? "text-gray-300 hover:bg-gray-800"
                : "text-gray-600 hover:bg-gray-100"
            }`}
            title="批量导入（先预览再确认）"
          >
            <Upload size={13} />
            批量导入
          </button>
          <button
            onClick={() => {
              setEditingEdge(null);
              setEditorMode("audit");
            }}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              isDark
                ? "text-gray-300 hover:bg-gray-800"
                : "text-gray-600 hover:bg-gray-100"
            }`}
            title="审计与撤销（最近操作可回滚）"
          >
            <History size={13} />
            审计/撤销
          </button>
          {/* D2-2：实体档案（含孤立实体） */}
          <button
            onClick={() => setEntitiesOpen(true)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              isDark
                ? "text-gray-300 hover:bg-gray-800"
                : "text-gray-600 hover:bg-gray-100"
            }`}
            title="实体档案（名称/描述/别名/标签；可创建孤立实体）"
          >
            <Plus size={13} />
            实体档案
          </button>
          {entitiesOpen && (
            <GraphEntitiesPanel
              isDark={isDark}
              onClose={() => setEntitiesOpen(false)}
              onChanged={() => {
                void load();
                void loadNodeNames();
              }}
            />
          )}
          <button
            onClick={load}
            disabled={loading}
            className={`p-1 rounded transition-colors ${isDark ? "text-gray-400 hover:text-gray-200 hover:bg-gray-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* B4：操作反馈（保存/删除/导入结果） */}
        {toast && (
          <div
            className={`text-xs px-4 py-2 ${
              isDark
                ? "bg-emerald-900/30 text-emerald-300"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {toast}
          </div>
        )}

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
              edges={canvasEdges}
              focusNode={focusNode ?? undefined}
              onFocusNode={setFocusNode}
              isDark={isDark}
              nodeNames={nodeNames}
              highlight={search}
            />
          )}
        </div>
      </div>

      {/* 右侧：编辑抽屉（优先）或节点详情面板 */}
      {editorMode ? (
        <GraphEdgeEditor
          isDark={isDark}
          mode={editorMode}
          edge={editingEdge}
          allowedTypes={allowedTypes}
          defaultDomain={defaultDomain}
          onClose={() => {
            setEditorMode(null);
            setEditingEdge(null);
          }}
          onSaved={(message) => {
            showToast(message);
            void load();
          }}
        />
      ) : (
        focusNode && (
          <div
            className={`w-56 shrink-0 p-3 border-l overflow-y-auto ${isDark ? "border-gray-700" : "border-gray-200"}`}
          >
            <GraphNodeDetail
              edges={focusEdges}
              focusNode={focusNode}
              isDark={isDark}
              onClear={() => setFocusNode(null)}
              onEditEdge={(edge) => {
                setEditingEdge(edge);
                setEditorMode("edit");
              }}
              onDeleteEntity={handleDeleteEntity}
            />
          </div>
        )
      )}
    </div>
  );
}
