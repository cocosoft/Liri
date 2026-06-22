import { useState } from "react";
import { useChatStore } from "../../stores/chatStore";
import type { FilePreview } from "../../types";

/**
 * 上下文面板组件
 *
 * 在 ChatArea 右侧可折叠显示，展示当前会话关联的文件列表。
 * 点击文件可预览其内容。
 */
export default function ContextPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const { sessionFiles, readFileToPreview, previewFile } = useChatStore();

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="flex-shrink-0 w-8 flex items-center justify-center border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        title="展开上下文面板"
      >
        <div className="flex flex-col items-center gap-1 text-gray-400 dark:text-gray-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[10px]">文件</span>
          {sessionFiles.length > 0 && (
            <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-full px-1">
              {sessionFiles.length}
            </span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="flex-shrink-0 w-64 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          上下文文件
          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal">
            ({sessionFiles.length})
          </span>
        </h3>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="折叠面板"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto">
        {sessionFiles.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              暂无关联文件
            </p>
            <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">
              AI 在对话中读取的文件将显示在此处
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-gray-800">
            {sessionFiles.map((file) => (
              <FileItem
                key={file.path}
                file={file}
                isSelected={previewFile?.path === file.path}
                onSelect={readFileToPreview}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * 单个文件项组件
 */
function FileItem({
  file,
  isSelected,
  onSelect,
}: {
  file: FilePreview;
  isSelected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(file.path)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
          isSelected
            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
            : "hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300"
        }`}
      >
        {/* 文件类型图标 */}
        <span className="text-xs flex-shrink-0">
          {file.type === "image" ? "\u{1F5BC}" :
           file.type === "markdown" ? "\u{1F4DD}" :
           file.type === "json" || file.type === "yaml" ? "\u{1F4CB}" :
           "\u{1F4C4}"}
        </span>

        {/* 文件名 */}
        <span className="text-xs truncate flex-1" title={file.path}>
          {file.name}
        </span>

        {/* 已加载标记 */}
        {file.content && (
          <span className="text-[10px] text-green-500 dark:text-green-400 flex-shrink-0">
            \u2713
          </span>
        )}
      </button>
    </li>
  );
}
