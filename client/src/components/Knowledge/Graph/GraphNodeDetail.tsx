import { memo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { GraphEdge } from "../../../types/project";

interface GraphNodeDetailProps {
  edges: GraphEdge[];
  focusNode: string;
  isDark: boolean;
  onClear: () => void;
  /** B4：点击某条关系的"编辑"（打开编辑抽屉） */
  onEditEdge?: (edge: GraphEdge) => void;
  /** B4：删除该实体（连同其全部边） */
  onDeleteEntity?: (entityId: string) => void;
}

export const GraphNodeDetail = memo(function GraphNodeDetail({
  edges,
  focusNode,
  isDark,
  onClear,
  onEditEdge,
  onDeleteEntity,
}: GraphNodeDetailProps) {
  const outgoing = edges.filter((e) => e.from === focusNode);
  const incoming = edges.filter((e) => e.to === focusNode);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const badge = `px-1 py-0 rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-200 text-gray-600"}`;
  const muted = `truncate ${isDark ? "text-gray-400" : "text-gray-500"}`;

  /** 单条关系行（出边/入边共用；B4 统一挂"编辑"入口） */
  const renderRow = (e: GraphEdge, kind: "out" | "in") => (
    <div key={e.id} className="flex items-center gap-1.5 text-[10px]">
      {kind === "in" ? (
        <>
          <span className={muted}>{e.from}</span>
          <span className="text-gray-500">→</span>
          <span className={badge}>{e.type}</span>
        </>
      ) : (
        <>
          <span className={badge}>{e.type}</span>
          <span className="text-gray-500">→</span>
          <span className={muted}>{e.to}</span>
        </>
      )}
      {onEditEdge && (
        <button
          onClick={() => onEditEdge(e)}
          className={`ml-auto shrink-0 ${isDark ? "text-gray-500 hover:text-blue-400" : "text-gray-400 hover:text-blue-600"}`}
          title="编辑这条关系"
        >
          <Pencil size={10} />
        </button>
      )}
    </div>
  );

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
            {outgoing.slice(0, 10).map((e) => renderRow(e, "out"))}
            {/* KB-L13：截断提示，避免"出边 (N)"与实际展示条数不符 */}
            {outgoing.length > 10 && (
              <div
                className={`text-[10px] ${isDark ? "text-gray-600" : "text-gray-400"}`}
              >
                还有 {outgoing.length - 10} 条
              </div>
            )}
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
            {incoming.slice(0, 10).map((e) => renderRow(e, "in"))}
            {/* KB-L13：截断提示 */}
            {incoming.length > 10 && (
              <div
                className={`text-[10px] ${isDark ? "text-gray-600" : "text-gray-400"}`}
              >
                还有 {incoming.length - 10} 条
              </div>
            )}
          </div>
        </div>
      )}

      {/* B4：实体级删除（本模型下实体依附于边，删除即删掉它的全部关系） */}
      {onDeleteEntity && (
        <div className="mt-2 pt-2 border-t border-dashed border-gray-500/30">
          <button
            onClick={() => {
              if (confirmingDelete) onDeleteEntity(focusNode);
              else setConfirmingDelete(true);
            }}
            className={`w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${
              confirmingDelete
                ? "bg-red-600 text-white border-red-600"
                : isDark
                  ? "border-gray-600 text-red-400 hover:bg-gray-700"
                  : "border-gray-300 text-red-600 hover:bg-gray-100"
            }`}
            title="删除该实体及其全部关系"
          >
            <Trash2 size={10} />
            {confirmingDelete
              ? `确认删除实体及其 ${edges.length} 条关系`
              : "删除该实体"}
          </button>
        </div>
      )}
    </div>
  );
});
