/**
 * CreateProjectModal — 新建项目弹窗
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRootStore } from "@/stores/root-store";

interface Props {
  onClose: () => void;
}

export default function CreateProjectModal({ onClose }: Props) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const createWorktree = useRootStore((s) => s.createWorktree);
  const navigate = useNavigate();

  const handleSubmit = async () => {
    setError("");

    if (!name.trim()) {
      setError("请输入项目名称");
      return;
    }
    if (!path.trim()) {
      setError("请输入项目路径");
      return;
    }

    setSubmitting(true);
    try {
      const id = createWorktree({
        name: name.trim(),
        path: path.trim(),
        description: description.trim() || undefined,
        workspaceSource: "user",
        workspaceType: "project",
      });
      navigate(`/projects/${id}`);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          新建项目
        </h2>

        {/* 名称 */}
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
          项目名称
        </label>
        <input
          type="text"
          className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 mb-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          placeholder="例如：my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        {/* 路径 */}
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
          本地路径
        </label>
        <input
          type="text"
          className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 mb-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          placeholder="例如：E:/Projects/my-app"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />

        {/* 描述 */}
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
          描述（可选）
        </label>
        <textarea
          className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 mb-4 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-none"
          placeholder="项目说明..."
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* 错误 */}
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* 按钮 */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
