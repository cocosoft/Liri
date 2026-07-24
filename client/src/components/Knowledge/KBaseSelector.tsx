/**
 * KBaseSelector — 知识库选择器 (Phase 1 W1)
 *
 * 顶部 pill 按钮选择知识库，支持双击重命名、删除。
 */
import type { KnowledgeBase } from "../../types";

interface KBaseSelectorProps {
  isDark: boolean;
  bases: KnowledgeBase[];
  selectedBase: string | null;
  editingBase: string | null;
  editLabel: string;
  onSelectBase: (name: string | null) => void;
  onStartEdit: (name: string, label: string) => void;
  onSetEditLabel: (label: string) => void;
  onRenameBase: (name: string) => void;
  onCancelEdit: () => void;
  onDeleteBase: (name: string) => void;
}

function KBaseSelector({
  isDark,
  bases,
  selectedBase,
  editingBase,
  editLabel,
  onSelectBase,
  onStartEdit,
  onSetEditLabel,
  onRenameBase,
  onCancelEdit,
  onDeleteBase,
}: KBaseSelectorProps) {
  const textMuted = isDark ? "text-gray-500" : "text-gray-400";

  return (
    <div className="px-4 py-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => onSelectBase(null)}
          className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            selectedBase === null
              ? "bg-blue-500 text-white"
              : isDark
                ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          全部
        </button>
        {bases.map((base) => (
          <div key={base.name} className="relative group flex-shrink-0">
            <button
              onClick={() => {
                if (editingBase === base.name) {
                  onRenameBase(base.name);
                } else {
                  onSelectBase(base.name);
                }
              }}
              onDoubleClick={() => onStartEdit(base.name, base.label)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedBase === base.name
                  ? "bg-blue-500 text-white"
                  : isDark
                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {editingBase === base.name ? (
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => onSetEditLabel(e.target.value)}
                  onBlur={() => onRenameBase(base.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRenameBase(base.name);
                    if (e.key === "Escape") onCancelEdit();
                  }}
                  className="w-16 bg-transparent border-b border-current outline-none text-center"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  {base.icon && <span className="mr-1">{base.icon}</span>}
                  {base.label}
                  <span
                    className={`ml-1 ${selectedBase === base.name ? "text-blue-200" : textMuted}`}
                  >
                    {base.docCount}
                  </span>
                </>
              )}
            </button>
            {base.source === "user" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteBase(base.name);
                }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="删除知识库"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default KBaseSelector;
