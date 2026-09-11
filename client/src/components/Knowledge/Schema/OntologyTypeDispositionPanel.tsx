import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { graphService } from "../../../services/graphService";
import { schemaService } from "../../../services/schemaService";
import type {
  GraphStats,
  OntologySchemaInfo,
} from "../../../types/project";

/**
 * 「白名单外关系类型处置」面板（D4 = 按类型批量处置 + 默认保留）
 *
 * 背景（2026-09-11 实测真实库）：3042 条存量边分布在 **988 个关系类型**上，其中 60% 的类型
 * 只出现 1 次（`包含`/`contains`/`includes` 这类同义写法各占一个类型）。逐条处置不可行，
 * 因此按**类型**粒度处置。
 *
 * 三个动作（默认什么都不做 = 保留）：
 * - **加入白名单**：把该类型写进 `edges.yaml`（需选端点 kind，要求先在实体类型表声明）
 * - **删除该类全部边**：服务端逐条删除（墓碑 + 审计，可逐条撤销），前端二次确认列明条数与后果
 * - **保持不变**：不动它（默认）
 *
 * 本面板**绝不自动删除任何数据**：不点"删除"就什么都不会发生。
 */

/** 首屏展示的类型条数（其余折叠，避免 900+ 行列表） */
const TOP_N = 20;

interface TypeRow {
  type: string;
  count: number;
}

interface OntologyTypeDispositionPanelProps {
  info: OntologySchemaInfo;
  isDark: boolean;
  /** 白名单变更后通知父页面重新拉取 */
  onChanged: () => void;
}

export function OntologyTypeDispositionPanel({
  info,
  isDark,
  onChanged,
}: OntologyTypeDispositionPanelProps) {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busyType, setBusyType] = useState("");
  const [editingType, setEditingType] = useState("");
  /** 加入白名单时的待填字段 */
  const [displayName, setDisplayName] = useState("");
  const [fromKind, setFromKind] = useState("");
  const [toKind, setToKind] = useState("");
  const [direction, setDirection] = useState<"directed" | "symmetric">(
    "directed",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const cardClass = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const divider = isDark ? "border-gray-700" : "border-gray-200";
  const inputClass = `border rounded px-2 py-1 text-xs ${
    isDark
      ? "bg-gray-900 border-gray-600 text-gray-100"
      : "bg-white border-gray-300 text-gray-900"
  }`;
  const secondaryButton = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50 ${
    isDark
      ? "border-gray-600 text-gray-300 hover:bg-gray-700"
      : "border-gray-300 text-gray-700 hover:bg-gray-100"
  }`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStats(await graphService.getStats());
    } catch (err) {
      setError(
        err instanceof Error
          ? `读取关系类型统计失败：${err.message}`
          : "读取关系类型统计失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 当前白名单里的关系类型 */
  const whitelist = useMemo(
    () => new Set(info.edges.map((edge) => edge.type)),
    [info.edges],
  );

  /** 白名单外类型（按条数降序） */
  const outsideTypes: TypeRow[] = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byType)
      .filter(([type]) => !whitelist.has(type))
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }, [stats, whitelist]);

  const outsideEdges = outsideTypes.reduce((sum, row) => sum + row.count, 0);
  const visible = expanded ? outsideTypes : outsideTypes.slice(0, TOP_N);

  /** 已声明的实体 kind（端点下拉选项） */
  const entityKinds = useMemo(
    () =>
      (info.form.entities.rows ?? [])
        .map((row) => (typeof row.kind === "string" ? row.kind : ""))
        .filter((kind) => kind),
    [info.form.entities.rows],
  );
  const canEditWhitelist =
    info.form.edges.expressible && entityKinds.length > 0;

  const startEdit = (type: string) => {
    setEditingType(type);
    setDisplayName(type);
    setFromKind(entityKinds[0] ?? "");
    setToKind(entityKinds[0] ?? "");
    setDirection("directed");
    setMessage("");
    setError("");
  };

  /** 把该类型追加进 edges.yaml（其余行原样保留，经服务端 dump + 校验 + 备份 + 原子写） */
  const confirmAddToWhitelist = async () => {
    if (!editingType) return;
    setBusyType(editingType);
    setError("");
    setMessage("");
    try {
      const rows = [...(info.form.edges.rows ?? [])];
      rows.push({
        type: editingType,
        displayName: displayName.trim() || editingType,
        endpoints: { from: fromKind, to: toKind },
        direction,
      });
      // O17：白名单写入同样带上当前域（域优先、域未声明本体时回落全局）
      await schemaService.putFile(
        "edges.yaml",
        { model: rows },
        info.domain ?? undefined,
      );
      setMessage(
        `已把「${editingType}」加入白名单（edges.yaml 已更新，写入只影响下一次编译）`,
      );
      setEditingType("");
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? `加入白名单失败：${err.message}`
          : "加入白名单失败",
      );
    } finally {
      setBusyType("");
    }
  };

  const removeType = async (row: TypeRow) => {
    const confirmed = confirm(
      `删除全部「${row.type}」关系（共 ${row.count} 条）？\n\n` +
        "· 删除后无法从图中直接看到这些边，但每条都留有审计记录，可在「知识图谱 → 审计撤销」逐条恢复\n" +
        "· 服务端会同时写入墓碑，确保后续自动抽取不会把它们加回来\n" +
        "· 如需万无一失，可先执行 `pyapp knowledge export-graph <文件>` 导出整库备份\n" +
        "· 此操作不改动本体文件",
    );
    if (!confirmed) return;

    setBusyType(row.type);
    setError("");
    setMessage("");
    try {
      const result = await graphService.deleteEdgesByType(row.type);
      setMessage(`已删除「${row.type}」的 ${result.deleted} 条关系`);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? `删除失败：${err.message}` : "删除失败",
      );
    } finally {
      setBusyType("");
    }
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${cardClass}`}>
      <div
        className={`px-4 py-2.5 flex items-center justify-between border-b ${divider}`}
      >
        <span className={`text-sm font-medium ${textPrimary}`}>
          白名单外的关系类型
          {stats
            ? `（${outsideTypes.length} 种 / 共 ${outsideEdges} 条边）`
            : ""}
        </span>
        <button
          onClick={() => void load()}
          disabled={loading}
          className={secondaryButton}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : null}
          刷新统计
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className={`text-xs ${textSecondary}`}>
          这些类型不在当前本体白名单内，<strong>默认保留、不会被自动删除</strong>
          。可以逐个决定：加入白名单（后续编译按它抽取）/ 删除该类型全部边 / 保持不变。
        </p>

        {error && (
          <div
            className={`px-3 py-2 rounded-md text-xs ${
              isDark
                ? "bg-red-900/30 text-red-300 border border-red-800"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {error}
          </div>
        )}
        {message && !error && (
          <div
            className={`px-3 py-2 rounded-md text-xs ${
              isDark
                ? "bg-emerald-900/30 text-emerald-300 border border-emerald-800"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}
          >
            {message}
          </div>
        )}

        {!canEditWhitelist && (
          <div
            className={`px-3 py-2 rounded-md text-xs border ${
              isDark
                ? "bg-amber-900/20 text-amber-300 border-amber-800"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}
          >
            「加入白名单」当前不可用：
            {entityKinds.length === 0
              ? "请先在实体类型表里声明至少一个 kind（关系的端点必须指向已声明的实体类型）"
              : "edges.yaml 含表单无法表达的内容，请改用原始 YAML 模式编辑"}
            。
          </div>
        )}

        {stats && outsideTypes.length === 0 ? (
          <div className={`text-xs ${textSecondary}`}>
            没有白名单外的关系类型（图内类型全部已在白名单中）。
          </div>
        ) : (
          <ul className="space-y-1">
            {visible.map((row) => (
              <li key={row.type} className="text-xs">
                <div className="flex items-center gap-3">
                  <span className={`font-mono w-64 truncate ${textPrimary}`}>
                    {row.type}
                  </span>
                  <span className={`w-16 ${textSecondary}`}>{row.count} 条</span>
                  <button
                    onClick={() => startEdit(row.type)}
                    disabled={!canEditWhitelist || busyType !== ""}
                    className={secondaryButton}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    加入白名单
                  </button>
                  <button
                    onClick={() => void removeType(row)}
                    disabled={busyType !== ""}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50 ${
                      isDark
                        ? "border-red-800 text-red-300 hover:bg-red-900/30"
                        : "border-red-200 text-red-700 hover:bg-red-50"
                    }`}
                  >
                    {busyType === row.type ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    删除该类全部边
                  </button>
                </div>

                {editingType === row.type && (
                  <div
                    className={`mt-2 ml-2 p-3 rounded-md border flex flex-wrap items-center gap-2 ${divider}`}
                  >
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="显示名称"
                      className={inputClass}
                    />
                    <span className={textSecondary}>端点</span>
                    <select
                      value={fromKind}
                      onChange={(event) => setFromKind(event.target.value)}
                      className={inputClass}
                    >
                      {entityKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                    <span className={textSecondary}>→</span>
                    <select
                      value={toKind}
                      onChange={(event) => setToKind(event.target.value)}
                      className={inputClass}
                    >
                      {entityKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                    <select
                      value={direction}
                      onChange={(event) =>
                        setDirection(
                          event.target.value as "directed" | "symmetric",
                        )
                      }
                      className={inputClass}
                    >
                      <option value="directed">有向</option>
                      <option value="symmetric">对称</option>
                    </select>
                    <button
                      onClick={() => void confirmAddToWhitelist()}
                      disabled={busyType !== ""}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busyType === row.type ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : null}
                      确认加入
                    </button>
                    <button
                      onClick={() => setEditingType("")}
                      className={secondaryButton}
                    >
                      取消
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {outsideTypes.length > TOP_N && (
          <button
            onClick={() => setExpanded((value) => !value)}
            className={`inline-flex items-center gap-1 text-xs ${textSecondary}`}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            {expanded
              ? "收起长尾"
              : `展开其余 ${outsideTypes.length - TOP_N} 个类型（多数只出现 1-2 次）`}
          </button>
        )}
      </div>
    </div>
  );
}
