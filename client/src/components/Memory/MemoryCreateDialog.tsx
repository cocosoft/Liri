import { useState } from "react";
import type { MemoryType } from "../../services/memoryService";
import { TYPE_OPTIONS } from "./memoryConstants";

interface MemoryCreateDialogProps {
  isDark: boolean;
  isOpen: boolean;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (data: {
    type: MemoryType;
    content: string;
    tags: string[];
    weight: number;
  }) => Promise<void>;
}

function MemoryCreateDialog({
  isDark,
  isOpen,
  isCreating,
  onClose,
  onCreate,
}: MemoryCreateDialogProps) {
  const [type, setType] = useState<MemoryType>("knowledge");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [weight, setWeight] = useState(50);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!content.trim()) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    await onCreate({ type, content: content.trim(), tags, weight });
    setType("knowledge");
    setContent("");
    setTagsInput("");
    setWeight(50);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
    >
      <div
        className={`w-full max-w-2xl mx-4 p-6 rounded-lg border ${
          isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
        }`}
      >
        <h2
          className={`text-lg font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          创建新记忆
        </h2>

        <div className="space-y-4">
          {/* 类型选择 */}
          <div>
            <label
              className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              记忆类型
            </label>
            <div className="flex flex-wrap gap-2">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setType(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    type === opt.value
                      ? isDark
                        ? "bg-blue-600 text-white"
                        : "bg-blue-500 text-white"
                      : isDark
                        ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 权重 */}
          <div>
            <label
              className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              权重 (1-100): {weight}
            </label>
            <input
              type="range"
              min={1}
              max={100}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* 标签 */}
          <div>
            <label
              className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              标签 (逗号分隔)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例如: 重要, 项目A, 待办"
              className={`w-full px-3 py-2 rounded-lg text-sm border ${
                isDark
                  ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                  : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>

          {/* 内容 */}
          <div>
            <label
              className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              记忆内容 *
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入记忆内容..."
              rows={6}
              className={`w-full p-3 rounded-lg text-sm border resize-y ${
                isDark
                  ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:border-blue-500"
                  : "bg-white border-gray-300 text-gray-900 placeholder-gray-500 focus:border-blue-500"
              } focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              isDark
                ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!content.trim() || isCreating}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !content.trim() || isCreating
                ? "bg-gray-400 text-white cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            {isCreating ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MemoryCreateDialog;
