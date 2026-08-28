/**
 * BatchTagModal — 批量加标签弹窗 (Phase 1 W1)
 */
interface BatchTagModalProps {
  isDark: boolean;
  selectedCount: number;
  tagInput: string;
  status: "idle" | "saving" | "error";
  onTagInputChange: (input: string) => void;
  onSave: () => void;
  onClose: () => void;
}

function BatchTagModal({
  isDark,
  selectedCount,
  tagInput,
  status,
  onTagInputChange,
  onSave,
  onClose,
}: BatchTagModalProps) {
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={`w-72 p-4 rounded-xl shadow-xl ${
          isDark
            ? "bg-gray-800 border border-gray-700"
            : "bg-white border border-gray-200"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className={`text-sm font-semibold mb-1 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          批量加标签
        </h3>
        <p className={`text-xs mb-3 ${textSecondary}`}>
          为选中的 {selectedCount} 个文档添加以下标签：
        </p>
        <input
          type="text"
          value={tagInput}
          onChange={(e) => onTagInputChange(e.target.value)}
          placeholder="输入标签，用逗号分隔"
          className={`w-full px-3 py-2 text-sm border rounded-md ${inputBg} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // 防重：保存中 Enter 不重复提交（与保存按钮 disabled 对齐）
              if (status !== "saving") onSave();
            }
            if (e.key === "Escape") onClose();
          }}
          autoFocus
        />
        {status === "error" && (
          <p className="text-xs text-red-500 mt-1">添加标签失败，请重试</p>
        )}
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={status === "saving" || !tagInput.trim()}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
          >
            {status === "saving" ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BatchTagModal;
