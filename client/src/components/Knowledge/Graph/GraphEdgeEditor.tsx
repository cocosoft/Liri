import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, Trash2, Upload, X } from "lucide-react";
import { graphService } from "../../../services/graphService";
import type { GraphAuditEntry, GraphEdge } from "../../../types/project";

type EditorMode = "create" | "edit" | "bulk" | "audit";

interface GraphEdgeEditorProps {
  isDark: boolean;
  mode: EditorMode | null;
  /** edit 模式下的目标边 */
  edge?: GraphEdge | null;
  /** 关系类型白名单（constrained 时非空；为空数组 = freeform，可自由输入） */
  allowedTypes: string[];
  /** 新建时的默认域 */
  defaultDomain?: string;
  onClose: () => void;
  /** 保存 / 删除 / 批量导入成功后回调（由父组件重新加载数据） */
  onSaved: (message: string) => void;
}

/**
 * 关系编辑抽屉（B4）
 *
 * 覆盖 create / edit / bulk 三种模式；实体在"仅边模型"下依附于关系，
 * 因此 `from` / `to` 直接填写（填新 ID 即同时创建该实体）。
 */
export function GraphEdgeEditor({
  isDark,
  mode,
  edge,
  allowedTypes,
  defaultDomain,
  onClose,
  onSaved,
}: GraphEdgeEditorProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");
  const [direction, setDirection] = useState<"directed" | "symmetric">(
    "directed",
  );
  const [attributesText, setAttributesText] = useState("{}");
  const [bulkText, setBulkText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // D5：审计模式的状态
  const [auditEntries, setAuditEntries] = useState<GraphAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditNotice, setAuditNotice] = useState("");

  const hasWhitelist = allowedTypes.length > 0;

  // 打开/切换模式时初始化表单
  useEffect(() => {
    setError("");
    setNotice("");
    setConfirmingDelete(false);
    if (mode === "edit" && edge) {
      setFrom(edge.from);
      setTo(edge.to);
      setType(edge.type);
      setDirection(edge.direction);
      setAttributesText(JSON.stringify(edge.attributes ?? {}, null, 2));
    } else if (mode === "create") {
      setFrom("");
      setTo("");
      setType(hasWhitelist ? allowedTypes[0] : "");
      setDirection("directed");
      setAttributesText("{}");
    }
  }, [mode, edge, hasWhitelist, allowedTypes]);

  // D5：审计模式 → 拉取最近操作（打开时刷新）
  useEffect(() => {
    if (mode !== "audit") return;
    let cancelled = false;
    setAuditLoading(true);
    setAuditNotice("");
    setError("");
    void graphService
      .listAudit({ limit: 50 })
      .then((res) => {
        if (!cancelled) setAuditEntries(res.entries);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "审计列表加载失败");
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  /** D5：撤销一次操作（后端按动作语义回滚） */
  const handleUndo = useCallback(
    async (auditId: string) => {
      setBusy(true);
      setError("");
      try {
        const result = await graphService.undoAudit(auditId);
        setAuditNotice(result.message);
        const refreshed = await graphService.listAudit({ limit: 50 });
        setAuditEntries(refreshed.entries);
        onSaved(result.message);
      } catch (err) {
        setError(err instanceof Error ? err.message : "撤销失败");
      } finally {
        setBusy(false);
      }
    },
    [onSaved],
  );

  const parseAttributes = useCallback(
    (text: string): Record<string, unknown> | null => {
      if (!text.trim()) return {};
      try {
        const parsed: unknown = JSON.parse(text);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          setError('属性需为 JSON 对象，例如 {"note": "说明"}');
          return null;
        }
        return parsed as Record<string, unknown>;
      } catch {
        setError('属性不是合法 JSON，请检查格式（例如 {"note": "说明"}）');
        return null;
      }
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setError("");
    setNotice("");
    if (!from.trim() || !to.trim() || !type.trim()) {
      setError("源实体、目标实体、关系类型均为必填");
      return;
    }
    const attributes = parseAttributes(attributesText);
    if (!attributes) return;

    setBusy(true);
    try {
      if (mode === "edit" && edge) {
        await graphService.updateEdge(edge.id, {
          type,
          direction,
          attributes,
        });
        onSaved("已保存修改");
      } else {
        await graphService.createEdge({
          from: from.trim(),
          to: to.trim(),
          type: type.trim(),
          direction,
          domain: defaultDomain,
          attributes,
        });
        onSaved("已新增关系（若已存在同源/目标/类型/域，则复用既有关系）");
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }, [
    from,
    to,
    type,
    direction,
    attributesText,
    mode,
    edge,
    defaultDomain,
    parseAttributes,
    onSaved,
    onClose,
  ]);

  const handleDelete = useCallback(async () => {
    if (!edge) return;
    setBusy(true);
    setError("");
    try {
      await graphService.deleteEdge(edge.id);
      onSaved("已删除该关系");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }, [edge, onSaved, onClose]);

  /** 批量导入：先解析预览，再确认提交 */
  const bulkPreview = useMemo(() => {
    if (mode !== "bulk") return null;
    const text = bulkText.trim();
    if (!text) return null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        return {
          error:
            '需要一个 JSON 数组，例如 [{"from":"a","to":"b","type":"relates_to"}]',
        };
      }
      const invalid = parsed.filter(
        (item) =>
          typeof item !== "object" ||
          item === null ||
          !String((item as Record<string, unknown>).from ?? "").trim() ||
          !String((item as Record<string, unknown>).to ?? "").trim() ||
          !String((item as Record<string, unknown>).type ?? "").trim(),
      ).length;
      return { total: parsed.length, invalid };
    } catch {
      return { error: "内容不是合法 JSON，请检查格式" };
    }
  }, [mode, bulkText]);

  const handleBulkImport = useCallback(async () => {
    setError("");
    setNotice("");
    let list: unknown;
    try {
      list = JSON.parse(bulkText);
    } catch {
      setError("内容不是合法 JSON，请检查格式");
      return;
    }
    if (!Array.isArray(list) || list.length === 0) {
      setError("需要一个非空的 JSON 数组");
      return;
    }

    setBusy(true);
    try {
      const result = await graphService.bulkCreateEdges(
        list as Parameters<typeof graphService.bulkCreateEdges>[0],
      );
      const failedText =
        result.failed.length > 0
          ? `，失败 ${result.failed.length} 条（第 ${result.failed
              .slice(0, 3)
              .map((f) => f.index + 1)
              .join("、")} 条等）`
          : "";
      onSaved(
        `批量导入完成：提交 ${result.submitted} 条，成功 ${result.ok} 条${failedText}`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量导入失败");
    } finally {
      setBusy(false);
    }
  }, [bulkText, onSaved, onClose]);

  if (!mode) return null;

  const bg = isDark
    ? "bg-gray-800 border-gray-700 text-gray-200"
    : "bg-white border-gray-200 text-gray-800";
  const label = `text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`;
  const input = `w-full px-2 py-1.5 text-xs rounded border outline-none focus:ring-1 ${
    isDark
      ? "bg-gray-900 border-gray-600 text-gray-100 focus:ring-blue-500"
      : "bg-white border-gray-300 text-gray-800 focus:ring-blue-400"
  }`;
  /** D5：审计动作 → 中文标签 */
  const ACTION_LABELS: Record<string, string> = {
    create: "新增",
    update: "修改",
    delete: "删除",
    restore: "恢复",
    undo: "撤销",
    cleanup: "自动清理",
    import: "导入",
  };

  const title =
    mode === "create"
      ? "新增关系"
      : mode === "edit"
        ? "编辑关系"
        : mode === "audit"
          ? "审计与撤销"
          : "批量导入";

  return (
    <div className="w-72 shrink-0 border-l flex flex-col overflow-y-auto">
      <div className={`flex-1 border-l-0 ${bg}`}>
        <div
          className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <span className="text-sm font-medium">{title}</span>
          <button onClick={onClose} title="关闭">
            <X size={14} />
          </button>
        </div>

        <div className="p-3 space-y-3">
          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 px-2 py-1.5 rounded">
              {error}
            </div>
          )}
          {notice && (
            <div className="text-xs text-emerald-500 bg-emerald-500/10 px-2 py-1.5 rounded">
              {notice}
            </div>
          )}

          {mode === "audit" ? (
            <>
              <div
                className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                最近 50
                条操作（append-only）。撤销按动作语义回滚：新增→删除、修改→回滚内容、删除→恢复并解除墓碑。
              </div>
              {auditNotice && (
                <div className="text-xs text-emerald-500 bg-emerald-500/10 px-2 py-1.5 rounded">
                  {auditNotice}
                </div>
              )}
              {auditLoading ? (
                <div
                  className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  加载中…
                </div>
              ) : auditEntries.length === 0 ? (
                <div
                  className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  暂无操作记录
                </div>
              ) : (
                <div className="space-y-1.5">
                  {auditEntries.map((entry) => {
                    const undoable =
                      entry.action === "create" ||
                      entry.action === "update" ||
                      entry.action === "delete";
                    return (
                      <div
                        key={entry.auditId}
                        className={`rounded border px-2 py-1.5 ${isDark ? "border-gray-700 bg-gray-900/40" : "border-gray-200 bg-gray-50"}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1 py-0 rounded text-[10px] ${
                              entry.origin === "manual"
                                ? "bg-blue-500/20 text-blue-400"
                                : "bg-gray-500/20 text-gray-400"
                            }`}
                          >
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </span>
                          <span
                            className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}
                          >
                            {entry.origin === "manual" ? "人工" : "自动"}
                          </span>
                          <span
                            className={`ml-auto text-[10px] ${isDark ? "text-gray-600" : "text-gray-400"}`}
                          >
                            {new Date(entry.createdAt).toLocaleTimeString()}
                          </span>
                          {undoable && (
                            <button
                              onClick={() => void handleUndo(entry.auditId)}
                              disabled={busy}
                              className={`text-[10px] disabled:opacity-50 ${
                                isDark
                                  ? "text-blue-400 hover:text-blue-300"
                                  : "text-blue-600 hover:text-blue-700"
                              }`}
                              title="撤销这次操作"
                            >
                              撤销
                            </button>
                          )}
                        </div>
                        <div
                          className={`mt-0.5 truncate font-mono text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}
                        >
                          {entry.edgeId ?? entry.note ?? "-"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : mode === "bulk" ? (
            <>
              <div>
                <div className={label}>JSON 数组</div>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={10}
                  placeholder={`[\n  {"from":"a","to":"b","type":"relates_to"}\n]`}
                  className={`${input} mt-1 font-mono`}
                />
              </div>
              {bulkPreview && (
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {"error" in bulkPreview ? (
                    <span className="text-amber-500">{bulkPreview.error}</span>
                  ) : (
                    <>
                      解析到 {bulkPreview.total} 条
                      {bulkPreview.invalid > 0 && (
                        <span className="text-amber-500">
                          ，其中 {bulkPreview.invalid}{" "}
                          条缺必填字段（导入时会失败并逐条报告）
                        </span>
                      )}
                      （单次上限 1000 条）
                    </>
                  )}
                </div>
              )}
              <button
                onClick={handleBulkImport}
                disabled={busy || !bulkText.trim()}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Upload size={13} />
                {busy ? "导入中…" : "确认导入"}
              </button>
            </>
          ) : (
            <>
              <div>
                <div className={label}>源实体 ID</div>
                <input
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  readOnly={mode === "edit"}
                  placeholder="如 knowledge:concept:ontology"
                  className={`${input} mt-1 font-mono ${mode === "edit" ? "opacity-60" : ""}`}
                />
              </div>
              <div>
                <div className={label}>目标实体 ID</div>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  readOnly={mode === "edit"}
                  placeholder="如 knowledge:person:zhang"
                  className={`${input} mt-1 font-mono ${mode === "edit" ? "opacity-60" : ""}`}
                />
              </div>
              {mode === "create" && (
                <div
                  className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  填新的实体 ID 即同时创建该实体（本模型下实体依附于关系）
                </div>
              )}

              <div>
                <div className={label}>关系类型</div>
                {hasWhitelist ? (
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className={`${input} mt-1`}
                  >
                    {allowedTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    placeholder="任意类型（当前 freeform，无白名单约束）"
                    className={`${input} mt-1 font-mono`}
                  />
                )}
              </div>

              <div>
                <div className={label}>方向</div>
                <select
                  value={direction}
                  onChange={(e) =>
                    setDirection(e.target.value as "directed" | "symmetric")
                  }
                  className={`${input} mt-1`}
                >
                  <option value="directed">有向（directed）</option>
                  <option value="symmetric">对称（symmetric）</option>
                </select>
              </div>

              <div>
                <div className={label}>属性（JSON，可选）</div>
                <textarea
                  value={attributesText}
                  onChange={(e) => setAttributesText(e.target.value)}
                  rows={5}
                  className={`${input} mt-1 font-mono`}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save size={13} />
                  {busy ? "保存中…" : "保存"}
                </button>
                {mode === "edit" && (
                  <button
                    onClick={() => {
                      if (confirmingDelete) void handleDelete();
                      else setConfirmingDelete(true);
                    }}
                    disabled={busy}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border disabled:opacity-50 ${
                      confirmingDelete
                        ? "bg-red-600 text-white border-red-600"
                        : isDark
                          ? "border-gray-600 text-red-400 hover:bg-gray-700"
                          : "border-gray-300 text-red-600 hover:bg-gray-100"
                    }`}
                    title="删除这条关系"
                  >
                    <Trash2 size={13} />
                    {confirmingDelete ? "确认删除" : "删除"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
