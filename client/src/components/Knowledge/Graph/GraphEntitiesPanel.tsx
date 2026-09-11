import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { graphService } from "../../../services/graphService";
import type { GraphNodeRecord } from "../../../types/project";

/**
 * 「实体档案」抽屉（D2-2）
 *
 * 数据来源：`GET/POST/PATCH/DELETE /v1/knowledge/graph/nodes*`。
 * 与"边"的职责边界：**边仍是关系的唯一来源**，本面板只维护实体自身档案
 * （名称 / 描述 / 别名 / 标签 / 自定义 attributes），并可创建**孤立实体**（暂无关系）。
 *
 * 已知约定：
 * - `node_id`（身份）不可改 —— 想改身份就删旧建新（避免边端点悬挂）；
 * - **O15-B**：实体 ID 统一为**裸 slug**（不再拼 `{domain}:{kind}:{slug}`），`kind`
 *   是档案属性（实体分类标签），可随时修改；
 * - `aliases` / `tags` 以逗号分隔编辑；`attributes` 以 JSON 对象编辑；
 * - 删除有关联边的实体会**级联删除其关系**，需二次确认。
 */

/** 单次拉取上限（服务端钳制 1..1000） */
const LIST_LIMIT = 500;
/** 最多渲染行数（其余靠搜索收敛） */
const MAX_ROWS = 300;

interface GraphEntitiesPanelProps {
  isDark: boolean;
  onClose: () => void;
  /** 档案变更后通知父页面（实体数/图数据可能变化） */
  onChanged: () => void;
}

interface ArchiveForm {
  kind: string;
  /** O15-B：实体 ID 即裸 slug（新建时填写，编辑时只读） */
  id: string;
  name: string;
  description: string;
  aliases: string;
  tags: string;
  attributes: string;
}

const EMPTY_FORM: ArchiveForm = {
  kind: "",
  id: "",
  name: "",
  description: "",
  aliases: "",
  tags: "",
  attributes: "{}",
};

/** JSON 数组字符串 → 逗号分隔文本（非法值按空处理） */
function toText(json: string): string {
  try {
    const value = JSON.parse(json || "[]");
    return Array.isArray(value) ? value.join(", ") : "";
  } catch {
    // @ignore-catch 库中字段异常（非法 JSON）→ 按空串展示，不阻塞面板
    return "";
  }
}

function splitList(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function GraphEntitiesPanel({
  isDark,
  onClose,
  onChanged,
}: GraphEntitiesPanelProps) {
  const [nodes, setNodes] = useState<GraphNodeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [editingId, setEditingId] = useState("");
  /** O15：正在合并的源实体 ID 与其目标 ID */
  const [mergingId, setMergingId] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ArchiveForm>(EMPTY_FORM);

  const border = isDark ? "border-gray-700" : "border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const inputClass = `w-full border rounded px-2 py-1 text-xs ${
    isDark
      ? "bg-gray-900 border-gray-600 text-gray-100 placeholder-gray-500"
      : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
  }`;
  const secondaryButton = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50 ${
    isDark
      ? "border-gray-600 text-gray-300 hover:bg-gray-700"
      : "border-gray-300 text-gray-700 hover:bg-gray-100"
  }`;

  /**
   * 拉取实体
   *
   * `term` 走**服务端**匹配（node_id / name / description / kind），
   * 因此搜索覆盖全库，而不是只搜"已加载窗口"那几百条（D2-3）。
   */
  const load = useCallback(async (term = "") => {
    setLoading(true);
    setError("");
    try {
      const data = await graphService.listNodes({
        limit: LIST_LIMIT,
        search: term.trim() || undefined,
      });
      setNodes(data.nodes);
    } catch (err) {
      setError(
        err instanceof Error ? `读取实体失败：${err.message}` : "读取实体失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // 搜索防抖 300ms（首次打开也会立刻拉一次）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(search);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  const visible = nodes.slice(0, MAX_ROWS);
  const isolated = nodes.filter((node) => (node.degree ?? 0) === 0).length;

  const startEdit = (node: GraphNodeRecord) => {
    setCreating(false);
    setEditingId(node.node_id);
    setError("");
    setMessage("");
    setForm({
      kind: node.kind,
      id: node.node_id,
      name: node.name,
      description: node.description,
      aliases: toText(node.aliases),
      tags: toText(node.tags),
      attributes: node.attributes || "{}",
    });
  };

  const startCreate = () => {
    setEditingId("");
    setCreating(true);
    setError("");
    setMessage("");
    setForm(EMPTY_FORM);
  };

  /** 解析 attributes 文本（必须是 JSON 对象） */
  const parseAttributes = (text: string): Record<string, unknown> | undefined => {
    const trimmed = text.trim();
    if (!trimmed || trimmed === "{}") return undefined;
    const value: unknown = JSON.parse(trimmed);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("attributes 需为 JSON 对象，例如 {\"role\":\"pm\"}");
    }
    return value as Record<string, unknown>;
  };

  const save = async () => {
    setError("");
    setMessage("");
    try {
      const attributes = parseAttributes(form.attributes);
      if (creating) {
        // O15-B：ID 即裸 slug（不再由 kind + slug 拼三段式）
        if (!form.id.trim()) {
          setError("新建实体需要填写 ID（裸 slug）");
          return;
        }
        setBusy("create");
        const node = await graphService.createNode({
          id: form.id.trim(),
          kind: form.kind.trim(),
          name: form.name.trim() || undefined,
          description: form.description.trim() || undefined,
          aliases: splitList(form.aliases),
          tags: splitList(form.tags),
          attributes,
        });
        setMessage(`已创建实体：${node.node_id}`);
        setCreating(false);
      } else {
        if (!editingId) return;
        setBusy(`save:${editingId}`);
        await graphService.updateNode(editingId, {
          kind: form.kind.trim(),
          name: form.name.trim(),
          description: form.description.trim(),
          aliases: splitList(form.aliases),
          tags: splitList(form.tags),
          ...(attributes ? { attributes } : {}),
        });
        setMessage(`已保存档案：${editingId}`);
        setEditingId("");
      }
      setForm(EMPTY_FORM);
      await load(search);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? `保存失败：${err.message}` : "保存失败");
    } finally {
      setBusy("");
    }
  };

  /**
   * O15：把该实体的**全部关系**改指到目标实体，并删除它自己
   *
   * 用于修复"同一实体被写成两个 ID"（如 `plan` 与 `pdca:plan`）。重复关系自动去重；
   * 每条改动写入审计，可逐条撤销。
   */
  const merge = async (node: GraphNodeRecord) => {
    const target = mergeTarget.trim();
    if (!target) {
      setError("请填写要并入的目标实体 ID");
      return;
    }
    if (target === node.node_id) {
      setError("不能合并到自身");
      return;
    }
    const confirmed = confirm(
      `把「${node.name || node.node_id}」的全部关系改指到「${target}」，并删除前者？\n\n` +
        "· 重复关系（同起点/终点/类型/域）会被去重合并\n" +
        "· 每条改动都写入审计，可逐条撤销\n" +
        "· 目标实体必须已存在",
    );
    if (!confirmed) return;

    setBusy(`merge:${node.node_id}`);
    setError("");
    setMessage("");
    try {
      const result = await graphService.mergeNodes(node.node_id, target);
      setMessage(
        `已合并到「${target}」：改指 ${result.repointed} 条关系${
          result.deduped ? `、去重 ${result.deduped} 条` : ""
        }`,
      );
      setMergingId("");
      setMergeTarget("");
      await load(search);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? `合并失败：${err.message}` : "合并失败");
    } finally {
      setBusy("");
    }
  };

  const remove = async (node: GraphNodeRecord) => {
    const degree = node.degree ?? 0;
    const confirmed = confirm(
      degree > 0
        ? `删除实体「${node.name || node.node_id}」？\n\n该实体有 ${degree} 条关联关系，将**一并删除**（写入墓碑与审计，不会在下次抽取时加回）。`
        : `删除实体「${node.name || node.node_id}」？（当前没有关联关系）`,
    );
    if (!confirmed) return;

    setBusy(`del:${node.node_id}`);
    setError("");
    setMessage("");
    try {
      const result = await graphService.deleteNode(node.node_id, degree > 0);
      setMessage(
        `已删除 ${node.node_id}${
          result.removedEdges ? `（级联删除 ${result.removedEdges} 条关系）` : ""
        }`,
      );
      await load(search);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? `删除失败：${err.message}` : "删除失败");
    } finally {
      setBusy("");
    }
  };

  const renderForm = () => (
    <div className={`mt-2 p-3 rounded-md border space-y-2 ${border}`}>
      <div className="flex flex-wrap gap-2">
        <input
          value={form.id}
          onChange={(event) => setForm({ ...form, id: event.target.value })}
          placeholder="ID（裸 slug，如 alice）"
          disabled={!creating}
          className={`${inputClass} w-44 font-mono`}
        />
        <input
          value={form.kind}
          onChange={(event) => setForm({ ...form, kind: event.target.value })}
          placeholder="kind（分类标签，如 person）"
          className={`${inputClass} w-40`}
        />
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="显示名称"
          className={`${inputClass} w-44`}
        />
      </div>
      <input
        value={form.description}
        onChange={(event) =>
          setForm({ ...form, description: event.target.value })
        }
        placeholder="描述"
        className={inputClass}
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={form.aliases}
          onChange={(event) => setForm({ ...form, aliases: event.target.value })}
          placeholder="别名（逗号分隔）"
          className={`${inputClass} w-56`}
        />
        <input
          value={form.tags}
          onChange={(event) => setForm({ ...form, tags: event.target.value })}
          placeholder="标签（逗号分隔）"
          className={`${inputClass} w-56`}
        />
      </div>
      <input
        value={form.attributes}
        onChange={(event) =>
          setForm({ ...form, attributes: event.target.value })
        }
        placeholder='自定义属性 JSON，如 {"role":"pm"}'
        className={`${inputClass} font-mono`}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={busy !== ""}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy !== "" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          保存
        </button>
        <button
          onClick={() => {
            setEditingId("");
            setCreating(false);
          }}
          className={secondaryButton}
        >
          取消
        </button>
        <span className={`text-xs ${textSecondary}`}>
          {creating
            ? "ID 即实体身份（裸 slug）；kind 为分类标签"
            : "ID（身份）不可改；kind 可改（分类标签）"}
        </span>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className={`relative w-[720px] max-w-full h-full overflow-y-auto border-l ${
          isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
        }`}
      >
        <div
          className={`sticky top-0 px-4 py-3 flex items-center justify-between border-b ${border} ${
            isDark ? "bg-gray-800" : "bg-white"
          }`}
        >
          <div>
            <div className={`text-sm font-medium ${textPrimary}`}>
              实体档案（{nodes.length}，其中孤立 {isolated}）
            </div>
            <div className={`text-xs mt-0.5 ${textSecondary}`}>
              边是关系的唯一来源；此处维护实体自身的名称/描述/别名/标签
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load(search)}
              disabled={loading}
              className={secondaryButton}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              刷新
            </button>
            <button onClick={startCreate} className={secondaryButton}>
              <Plus className="w-3.5 h-3.5" />
              新建实体
            </button>
            <button onClick={onClose} className={secondaryButton}>
              <X className="w-3.5 h-3.5" />
              关闭
            </button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
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

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索 id / 名称 / 描述 / kind"
            className={inputClass}
          />

          {creating && renderForm()}

          {visible.length === 0 ? (
            <div className={`text-xs ${textSecondary}`}>
              {loading ? "加载中…" : "没有匹配的实体"}
            </div>
          ) : (
            <ul className="space-y-1">
              {visible.map((node) => (
                <li key={node.node_id} className="text-xs">
                  <div className="flex items-center gap-3">
                    <span className={`w-56 truncate ${textPrimary}`}>
                      {node.name || node.slug || node.node_id}
                      {node.source === "manual" ? (
                        <span className={`ml-2 ${textSecondary}`}>· 人工</span>
                      ) : null}
                    </span>
                    <span
                      className={`font-mono w-72 truncate ${textSecondary}`}
                      title={node.node_id}
                    >
                      {node.node_id}
                    </span>
                    <span className={`w-16 ${textSecondary}`}>
                      {node.degree ?? 0} 条边
                    </span>
                    <button
                      onClick={() => startEdit(node)}
                      className={secondaryButton}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => {
                        setMergingId(node.node_id);
                        setMergeTarget("");
                        setEditingId("");
                        setCreating(false);
                        setError("");
                        setMessage("");
                      }}
                      className={secondaryButton}
                      title="把该实体的关系合并到另一个实体（修复同一实体两个 ID）"
                    >
                      合并到…
                    </button>
                    <button
                      onClick={() => void remove(node)}
                      disabled={busy !== ""}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50 ${
                        isDark
                          ? "border-red-800 text-red-300 hover:bg-red-900/30"
                          : "border-red-200 text-red-700 hover:bg-red-50"
                      }`}
                    >
                      {busy === `del:${node.node_id}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      删除
                    </button>
                  </div>
                  {editingId === node.node_id && renderForm()}

                  {mergingId === node.node_id && (
                    <div
                      className={`mt-2 ml-2 p-3 rounded-md border flex flex-wrap items-center gap-2 ${border}`}
                    >
                      <span className={textSecondary}>合并到</span>
                      <input
                        value={mergeTarget}
                        onChange={(event) => setMergeTarget(event.target.value)}
                        placeholder="目标实体 ID（须已存在）"
                        className={`${inputClass} w-72 font-mono`}
                      />
                      <button
                        onClick={() => void merge(node)}
                        disabled={busy !== ""}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {busy === `merge:${node.node_id}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : null}
                        确认合并
                      </button>
                      <button
                        onClick={() => {
                          setMergingId("");
                          setMergeTarget("");
                        }}
                        className={secondaryButton}
                      >
                        取消
                      </button>
                      <span className={`text-xs ${textSecondary}`}>
                        关系改指过去，重复关系自动去重
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {nodes.length > MAX_ROWS && (
            <div className={`text-xs ${textSecondary}`}>
              仅显示前 {MAX_ROWS} 条（本次匹配 {nodes.length} 条），请用搜索收敛
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
