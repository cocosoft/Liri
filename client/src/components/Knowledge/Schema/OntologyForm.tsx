import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { graphService } from "../../../services/graphService";
import { schemaService } from "../../../services/schemaService";
import type {
  OntologyFormModels,
  OntologySchemaFile,
  OntologySchemaInfo,
  OntologyValidationResult,
} from "../../../types/project";
import { OntologyIssueList } from "./OntologyIssueList";

/**
 * 本体「表单模式」编辑器（D1 = C 混合编辑器的前端一半）
 *
 * 设计约束（方案 §11.2 / §11.6）：
 * - 表单只编辑 kind/displayName/description 与 endpoints/direction；
 *   行内**未知键（如 fields、attributes、自定义键）原样保留**，不做有损转换；
 * - 提交的是**结构化 model**，由服务端 dump 成 YAML 并走同一套校验 + 备份 + 原子写；
 * - 保存前先做一次草稿校验（`scope=draft`），不通过则**不写盘**并逐项提示。
 *
 * 已知限制：字段定义（fields）/关系属性（attributes）本轮不提供可视化编辑，原样保留。
 */

interface EntityRowState {
  key: string;
  kind: string;
  displayName: string;
  description: string;
  /** 原始行对象（保留未知键） */
  raw: Record<string, unknown>;
}

interface EdgeRowState {
  key: string;
  type: string;
  displayName: string;
  from: string;
  to: string;
  direction: "directed" | "symmetric";
  raw: Record<string, unknown>;
}

let rowSeq = 0;
function nextKey(prefix: string): string {
  rowSeq += 1;
  return `${prefix}-${rowSeq}`;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toEntityRows(form: OntologyFormModels): EntityRowState[] {
  return (form.entities.rows ?? []).map((raw) => ({
    key: nextKey("entity"),
    kind: asText(raw.kind),
    displayName: asText(raw.displayName),
    description: asText(raw.description),
    raw,
  }));
}

function toEdgeRows(form: OntologyFormModels): EdgeRowState[] {
  return (form.edges.rows ?? []).map((raw) => {
    const endpoints = asRecord(raw.endpoints);
    return {
      key: nextKey("edge"),
      type: asText(raw.type),
      displayName: asText(raw.displayName),
      from: asText(endpoints.from),
      to: asText(endpoints.to),
      direction: raw.direction === "symmetric" ? "symmetric" : "directed",
      raw,
    };
  });
}

/** 表单行 → 实体模型（未知键保留；清空的展示字段直接删键，不留空串） */
function buildEntityRows(rows: EntityRowState[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row.raw, kind: row.kind.trim() };
    const displayName = row.displayName.trim();
    if (displayName) out.displayName = displayName;
    else delete out.displayName;
    const description = row.description.trim();
    if (description) out.description = description;
    else delete out.description;
    return out;
  });
}

function buildEdgeRows(rows: EdgeRowState[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = {
      ...row.raw,
      type: row.type.trim(),
      endpoints: {
        ...asRecord(row.raw.endpoints),
        from: row.from.trim(),
        to: row.to.trim(),
      },
      direction: row.direction,
    };
    const displayName = row.displayName.trim();
    if (displayName) out.displayName = displayName;
    else delete out.displayName;
    return out;
  });
}

interface OntologyFormProps {
  info: OntologySchemaInfo;
  isDark: boolean;
  /** 保存成功后通知父组件重新拉取（磁盘是唯一事实来源） */
  onSaved: () => void;
}

export function OntologyForm({ info, isDark, onSaved }: OntologyFormProps) {
  const [entityRows, setEntityRows] = useState<EntityRowState[]>(() =>
    toEntityRows(info.form),
  );
  const [edgeRows, setEdgeRows] = useState<EdgeRowState[]>(() =>
    toEdgeRows(info.form),
  );
  const [dirtyEntities, setDirtyEntities] = useState(false);
  const [dirtyEdges, setDirtyEdges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<OntologyValidationResult | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** 图中各关系类型的边数（删除影响面提示；首次用到时才拉取） */
  const edgeTypeCounts = useRef<Record<string, number> | null>(null);

  // 磁盘重新加载后（保存完成 / 切换 Tab）以磁盘为准重置表单
  useEffect(() => {
    setEntityRows(toEntityRows(info.form));
    setEdgeRows(toEdgeRows(info.form));
    setDirtyEntities(false);
    setDirtyEdges(false);
  }, [info]);

  const cardClass = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const rowHover = isDark ? "hover:bg-gray-700/40" : "hover:bg-gray-50";
  const headClass = isDark
    ? "text-gray-400 border-gray-700"
    : "text-gray-500 border-gray-200";
  const inputClass = `w-full border rounded px-2 py-1 text-xs ${
    isDark
      ? "bg-gray-900 border-gray-600 text-gray-100 placeholder-gray-500"
      : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
  }`;

  const entityKinds = useMemo(
    () => entityRows.map((row) => row.kind.trim()).filter((kind) => kind),
    [entityRows],
  );

  const endpointOptions = useCallback(
    (current: string) => {
      const options = entityKinds.map((kind) => ({ value: kind, label: kind }));
      if (current && !entityKinds.includes(current)) {
        options.unshift({ value: current, label: `${current}（未声明）` });
      }
      return options;
    },
    [entityKinds],
  );

  const updateEntity = (key: string, patch: Partial<EntityRowState>) => {
    setEntityRows((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    setDirtyEntities(true);
  };

  const updateEdge = (key: string, patch: Partial<EdgeRowState>) => {
    setEdgeRows((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    setDirtyEdges(true);
  };

  const addEntity = () => {
    setEntityRows((rows) => [
      ...rows,
      {
        key: nextKey("entity"),
        kind: "",
        displayName: "",
        description: "",
        raw: {},
      },
    ]);
    setDirtyEntities(true);
  };

  const addEdge = () => {
    setEdgeRows((rows) => [
      ...rows,
      {
        key: nextKey("edge"),
        type: "",
        displayName: "",
        from: entityKinds[0] ?? "",
        to: entityKinds[0] ?? "",
        direction: "directed",
        raw: {},
      },
    ]);
    setDirtyEdges(true);
  };

  const removeEntity = (row: EntityRowState) => {
    const kind = row.kind.trim();
    const referenced = kind
      ? edgeRows.filter(
          (edge) => edge.from.trim() === kind || edge.to.trim() === kind,
        ).length
      : 0;
    const impact =
      referenced > 0
        ? `\n\n该类型被 ${referenced} 条关系声明引用，删除后需一并改掉这些关系的端点，否则保存会被拒绝。`
        : "";
    if (!confirm(`删除实体类型「${kind || "(未命名)"}」？${impact}`)) return;
    setEntityRows((rows) => rows.filter((item) => item.key !== row.key));
    setDirtyEntities(true);
  };

  const removeEdge = async (row: EdgeRowState) => {
    const type = row.type.trim();
    let impact = "";
    if (type) {
      try {
        if (!edgeTypeCounts.current) {
          const stats = await graphService.getStats();
          edgeTypeCounts.current = stats.byType;
        }
        const count = edgeTypeCounts.current[type] ?? 0;
        if (count > 0) {
          impact = `\n\n图中已有 ${count} 条该类型的关系；移出白名单后它们不会被删除，只是后续编译不再抽取该类型。`;
        }
      } catch {
        // @ignore-catch 影响面统计失败不阻塞删除，仅省略条数提示
      }
    }
    if (!confirm(`删除关系类型「${type || "(未命名)"}」？${impact}`)) return;
    setEdgeRows((rows) => rows.filter((item) => item.key !== row.key));
    setDirtyEdges(true);
  };

  /** 当前表单的待保存内容（保存与草稿校验共用） */
  const collectDraft = useCallback((): Partial<
    Record<OntologySchemaFile, Array<Record<string, unknown>>>
  > => {
    const draft: Partial<
      Record<OntologySchemaFile, Array<Record<string, unknown>>>
    > = {};
    if (dirtyEntities) draft["entities.yaml"] = buildEntityRows(entityRows);
    if (dirtyEdges) draft["edges.yaml"] = buildEdgeRows(edgeRows);
    return draft;
  }, [dirtyEntities, dirtyEdges, entityRows, edgeRows]);

  const validateForm = useCallback(async () => {
    setError("");
    setMessage("");
    try {
      const checked = await schemaService.validate(
        {
          models: {
            "entities.yaml": buildEntityRows(entityRows),
            "edges.yaml": buildEdgeRows(edgeRows),
          },
        },
        // O17：带上当前域（服务端语义：域优先、域未声明本体时回落全局）
        info.domain ?? undefined,
      );
      setResult(checked);
      if (!checked.ok) setError("校验未通过：请先修正下列问题");
      return checked.ok;
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? `校验失败：${err.message}` : "校验失败");
      return false;
    }
  }, [edgeRows, entityRows]);

  const writtenFiles: string[] = [];

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    setResult(null);
    try {
      const draft = collectDraft();
      if (Object.keys(draft).length === 0) {
        setMessage("没有改动需要保存");
        return;
      }
      const checked = await schemaService.validate(
        { models: draft },
        info.domain ?? undefined,
      );
      setResult(checked);
      if (!checked.ok) {
        setError("校验未通过，未写入任何文件");
        return;
      }
      for (const file of Object.keys(draft) as OntologySchemaFile[]) {
        const written = await schemaService.putFile(
          file,
          { model: draft[file]! },
          info.domain ?? undefined,
        );
        writtenFiles.push(
          written.backup ? `${file}（旧版本已备份）` : `${file}`,
        );
      }
      setMessage(
        `已保存 ${writtenFiles.join("、")}。写入只影响下一次编译，不会改动已入库的数据。`,
      );
      setDirtyEntities(false);
      setDirtyEdges(false);
      onSaved();
    } catch (err) {
      const message0 =
        err instanceof Error ? err.message : "保存失败，请稍后重试";
      setError(
        writtenFiles.length > 0
          ? `已保存 ${writtenFiles.join("、")}；其余未写入：${message0}`
          : message0,
      );
    } finally {
      setSaving(false);
    }
  };

  const dirty = dirtyEntities || dirtyEdges;

  return (
    <div className="space-y-4">
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

      {result && (
        <div className={`border rounded-lg p-4 ${cardClass}`}>
          <div className="flex items-center gap-2">
            {result.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : (
              <span className="w-4 h-4 text-red-500">!</span>
            )}
            <span className={`text-sm font-medium ${textPrimary}`}>
              {result.ok ? "校验通过" : "存在错误"}
            </span>
            <span className={`text-xs ${textSecondary}`}>
              {result.errors.length} 个错误 · {result.warnings.length} 个提醒
            </span>
          </div>
          <OntologyIssueList
            issues={[...result.errors, ...result.warnings]}
            isDark={isDark}
          />
        </div>
      )}

      {/* 实体类型表 */}
      <div className={`border rounded-lg overflow-hidden ${cardClass}`}>
        <div
          className={`px-4 py-2.5 flex items-center justify-between border-b ${textPrimary} ${headClass}`}
        >
          <span className="text-sm font-medium">
            实体类型（{entityRows.length}）
          </span>
          <button
            onClick={addEntity}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-400/40 hover:bg-black/5"
          >
            <Plus className="w-3.5 h-3.5" />
            新增实体类型
          </button>
        </div>
        {entityRows.length === 0 ? (
          <div className={`px-4 py-4 text-xs ${textSecondary}`}>
            暂无实体类型；新增后知识图谱将只抽取这些类型（实体类型受限）。
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className={`border-b ${headClass}`}>
                <th className="text-left font-medium px-4 py-2">kind</th>
                <th className="text-left font-medium px-4 py-2">显示名称</th>
                <th className="text-left font-medium px-4 py-2">说明</th>
                <th className="text-left font-medium px-4 py-2">字段</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {entityRows.map((row) => (
                <tr key={row.key} className={rowHover}>
                  <td className="px-4 py-2 w-40">
                    <input
                      value={row.kind}
                      onChange={(event) =>
                        updateEntity(row.key, { kind: event.target.value })
                      }
                      placeholder="note"
                      className={`${inputClass} font-mono`}
                    />
                  </td>
                  <td className="px-4 py-2 w-40">
                    <input
                      value={row.displayName}
                      onChange={(event) =>
                        updateEntity(row.key, {
                          displayName: event.target.value,
                        })
                      }
                      placeholder="笔记"
                      className={inputClass}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={row.description}
                      onChange={(event) =>
                        updateEntity(row.key, {
                          description: event.target.value,
                        })
                      }
                      placeholder="可选说明"
                      className={inputClass}
                    />
                  </td>
                  <td className={`px-4 py-2 w-16 ${textSecondary}`}>
                    {Object.keys(asRecord(row.raw.fields)).length}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => removeEntity(row)}
                      title="删除该实体类型"
                      className="p-1 rounded text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={`px-4 py-2 text-xs border-t ${headClass} ${textSecondary}`}>
          字段定义（fields）本轮不在表单内编辑，保存时原样保留。
        </div>
      </div>

      {/* 关系类型表 */}
      <div className={`border rounded-lg overflow-hidden ${cardClass}`}>
        <div
          className={`px-4 py-2.5 flex items-center justify-between border-b ${textPrimary} ${headClass}`}
        >
          <span className="text-sm font-medium">
            关系类型（{edgeRows.length}）
          </span>
          <button
            onClick={addEdge}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-400/40 hover:bg-black/5"
          >
            <Plus className="w-3.5 h-3.5" />
            新增关系类型
          </button>
        </div>
        {edgeRows.length === 0 ? (
          <div className={`px-4 py-4 text-xs ${textSecondary}`}>
            暂无关系类型；只有实体声明时，关系不受约束（全部保留）。
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className={`border-b ${headClass}`}>
                <th className="text-left font-medium px-4 py-2">type</th>
                <th className="text-left font-medium px-4 py-2">显示名称</th>
                <th className="text-left font-medium px-4 py-2">起点类型</th>
                <th className="text-left font-medium px-4 py-2">终点类型</th>
                <th className="text-left font-medium px-4 py-2">方向</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {edgeRows.map((row) => (
                <tr key={row.key} className={rowHover}>
                  <td className="px-4 py-2 w-36">
                    <input
                      value={row.type}
                      onChange={(event) =>
                        updateEdge(row.key, { type: event.target.value })
                      }
                      placeholder="mentions"
                      className={`${inputClass} font-mono`}
                    />
                  </td>
                  <td className="px-4 py-2 w-32">
                    <input
                      value={row.displayName}
                      onChange={(event) =>
                        updateEdge(row.key, { displayName: event.target.value })
                      }
                      placeholder="提及"
                      className={inputClass}
                    />
                  </td>
                  <td className="px-4 py-2 w-40">
                    <select
                      value={row.from}
                      onChange={(event) =>
                        updateEdge(row.key, { from: event.target.value })
                      }
                      className={inputClass}
                    >
                      <option value="">选择…</option>
                      {endpointOptions(row.from).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 w-40">
                    <select
                      value={row.to}
                      onChange={(event) =>
                        updateEdge(row.key, { to: event.target.value })
                      }
                      className={inputClass}
                    >
                      <option value="">选择…</option>
                      {endpointOptions(row.to).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 w-28">
                    <select
                      value={row.direction}
                      onChange={(event) =>
                        updateEdge(row.key, {
                          direction: event.target
                            .value as EdgeRowState["direction"],
                        })
                      }
                      className={inputClass}
                    >
                      <option value="directed">有向</option>
                      <option value="symmetric">对称</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => void removeEdge(row)}
                      title="删除该关系类型"
                      className="p-1 rounded text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 操作区 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          保存
        </button>
        <button
          onClick={() => void validateForm()}
          disabled={saving}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50 ${
            isDark
              ? "border-gray-600 text-gray-300 hover:bg-gray-700"
              : "border-gray-300 text-gray-700 hover:bg-gray-100"
          }`}
        >
          校验当前表单
        </button>
        <span className={`text-xs ${textSecondary}`}>
          {dirty ? "有未保存的改动" : "与磁盘一致"}
        </span>
      </div>
    </div>
  );
}
