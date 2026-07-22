/**
 * 保存到知识库弹窗组件
 */
import { useState, useEffect } from "react";
import { createLogger } from "@/utils/logger";
import { knowledgeService } from "../../services/knowledgeService";

const logger = createLogger("components:saveKnowledge");

interface SaveKnowledgeModalProps {
  isDark: boolean;
  initialTitle: string;
  onClose: () => void;
  onSave: (title: string, base: string) => Promise<void>;
}

function SaveKnowledgeModal({
  isDark,
  initialTitle,
  onClose,
  onSave,
}: SaveKnowledgeModalProps) {
  const [saveTitle, setSaveTitle] = useState(initialTitle);
  const [saveBase, setSaveBase] = useState("default");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [bases, setBases] = useState<string[]>(["default"]);

  useEffect(() => {
    knowledgeService
      .listBases()
      .then((list) => {
        if (list.length > 0) setBases(list.map((b) => b.name));
      })
      .catch(() => {
        /* keep default */
      });
  }, []);

  const handleSave = async () => {
    if (!saveTitle.trim()) return;
    setSaveStatus("saving");
    try {
      await onSave(saveTitle.trim(), saveBase);
      setSaveStatus("saved");
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      logger.warn("保存知识失败", err);
      setSaveStatus("error");
    }
  };

  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className={`w-96 p-5 rounded-xl shadow-xl ${isDark ? "bg-gray-800 border border-gray-700" : "bg-white border border-gray-200"}`}
      >
        <h3
          className={`text-sm font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          保存到知识库
        </h3>
        <div className="space-y-3">
          <div>
            <label
              className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              标题
            </label>
            <input
              type="text"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="文档标题"
              className={`w-full px-3 py-2 border rounded-md text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
          <div>
            <label
              className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              知识库
            </label>
            <input
              type="text"
              list="base-options"
              value={saveBase}
              onChange={(e) => setSaveBase(e.target.value)}
              placeholder="选择或输入知识库名称"
              className={`w-full px-3 py-2 border rounded-md text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            <datalist id="base-options">
              {bases.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          {saveStatus === "error" && (
            <p className="text-xs text-red-500">保存失败，请重试</p>
          )}
          {saveStatus === "saved" && (
            <p className="text-xs text-emerald-500">保存成功</p>
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
            onClick={handleSave}
            disabled={saveStatus === "saving" || !saveTitle.trim()}
            className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-md"
          >
            {saveStatus === "saving" ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SaveKnowledgeModal;
