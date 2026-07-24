/**
 * CreateBaseModal — 创建知识库弹窗 (Phase 1 W1)
 */
interface CreateBaseModalProps {
  isDark: boolean;
  name: string;
  label: string;
  icon: string;
  status: "idle" | "creating" | "error";
  onNameChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onIconChange: (value: string) => void;
  onCreate: () => void;
  onClose: () => void;
}

function CreateBaseModal({
  isDark,
  name,
  label,
  icon,
  status,
  onNameChange,
  onLabelChange,
  onIconChange,
  onCreate,
  onClose,
}: CreateBaseModalProps) {
  const inputClass = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className={`w-80 p-5 rounded-xl shadow-xl ${
          isDark
            ? "bg-gray-800 border border-gray-700"
            : "bg-white border border-gray-200"
        }`}
      >
        <h3
          className={`text-sm font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          新建知识库
        </h3>
        <div className="space-y-3">
          <div>
            <label
              className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              名称（用于目录命名）
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="如: my-knowledge"
              className={`w-full px-3 py-2 border rounded-md text-sm ${inputClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
          <div>
            <label
              className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              显示名称
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="如: 我的知识库"
              className={`w-full px-3 py-2 border rounded-md text-sm ${inputClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
          <div>
            <label
              className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              图标（可选）
            </label>
            <input
              type="text"
              value={icon}
              onChange={(e) => onIconChange(e.target.value)}
              placeholder="如: 📚"
              className={`w-full px-3 py-2 border rounded-md text-sm ${inputClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
          {status === "error" && (
            <p className="text-xs text-red-500">创建失败，请重试</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
          >
            取消
          </button>
          <button
            onClick={onCreate}
            disabled={status === "creating" || !name.trim()}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
          >
            {status === "creating" ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateBaseModal;
