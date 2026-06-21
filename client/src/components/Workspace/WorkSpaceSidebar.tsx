import { useState } from "react";
import DirectoryTree from "../views/DirectoryTree";
import { useWorkStore } from "../../stores/workStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

interface WorkSpaceSidebarProps {
  className?: string;
}

/** 工作界面默认根目录列表 */
const DEFAULT_ROOTS = [
  { key: "workspace", label: "工作区", path: ".", icon: "\u{1F4C1}" },
];

/** 工作项状态标签映射 */
const STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  in_progress: "执行中",
  done: "已完成",
  failed: "失败",
};

/** 工作项状态颜色映射 */
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-300 dark:bg-gray-600",
  in_progress: "bg-blue-500",
  done: "bg-green-500",
  failed: "bg-red-500",
};

/**
 * 左侧面板容器
 * 上部：工作项列表（从 workspaceStore 读取，支持创建新工作项）
 * 下部：文件树（复用 DirectoryTree 组件）
 */
export default function WorkSpaceSidebar({ className }: WorkSpaceSidebarProps) {
  const activeWorkItem = useWorkStore((s) => s.activeWorkItem);
  const setActiveWorkItem = useWorkStore((s) => s.setActiveWorkItem);

  const workItems = useWorkspaceStore((s) => s.workItems);
  const createWorkItem = useWorkspaceStore((s) => s.createWorkItem);

  const [newTitle, setNewTitle] = useState("");
  const [showInput, setShowInput] = useState(false);

  /**
   * 创建新工作项
   */
  const handleCreate = () => {
    const title = newTitle.trim();
    if (!title) return;
    createWorkItem(title);
    setNewTitle("");
    setShowInput(false);
  };

  /**
   * 键盘事件：Enter 创建，Esc 取消
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      setShowInput(false);
      setNewTitle("");
    }
  };

  return (
    <div className={`${className} flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700`}>
      {/* 上半部分：工作项列表 */}
      <div className="flex-1 min-h-[120px] border-b border-gray-200 dark:border-gray-700 overflow-auto flex flex-col">
        {/* 标题栏 + 新增按钮 */}
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            工作项
          </h4>
          <button
            onClick={() => setShowInput(true)}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            title="新增工作项"
          >
            +
          </button>
        </div>

        {/* 新增工作项输入框 */}
        {showInput && (
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="工作项名称..."
                autoFocus
                className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded
                           bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100
                           focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim()}
                className="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600
                           disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        )}

        {/* 工作项列表 */}
        <div className="flex-1 overflow-auto">
          {workItems.length > 0 ? (
            <div className="py-1">
              {workItems.map((item) => {
                const isActive = activeWorkItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveWorkItem(item)}
                    className={`w-full px-3 py-2 text-left transition-colors border-l-2 ${
                      isActive
                        ? "border-l-blue-500 bg-blue-50 dark:bg-blue-900/20"
                        : "border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* 状态指示点 */}
                      <span
                        className={`flex-shrink-0 w-2 h-2 rounded-full ${STATUS_COLORS[item.status] || "bg-gray-400"}`}
                        title={STATUS_LABELS[item.status] || item.status}
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">
                        {item.title}
                      </span>
                    </div>
                    {item.description && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 ml-4 truncate">
                        {item.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full py-4">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {showInput ? "输入名称后按确定创建" : "暂无工作项，点击 + 创建"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 下半部分：文件树 */}
      <div className="flex-1 overflow-auto">
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            文件树
          </h4>
        </div>
        <DirectoryTree
          currentPath="."
          onNavigate={() => {}}
          roots={DEFAULT_ROOTS}
          currentRoot="workspace"
          onRootChange={() => {}}
        />
      </div>
    </div>
  );
}