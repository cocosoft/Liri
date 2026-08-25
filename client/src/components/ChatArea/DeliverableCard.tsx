import type { DeliverableData } from "../../types";

interface DeliverableCardProps {
  data: DeliverableData;
  onAction?: (action: string, file?: string) => void;
  /** 进入工作模式回调（从聊天界面跳转到工作界面） */
  onEnterWorkMode?: () => void;
  /** 后端 Workspace API 是否就绪（未就绪时禁用按钮） */
  workModeReady?: boolean;
}

const CHANGE_LABELS: Record<string, string> = {
  added: "[A]",
  modified: "[M]",
  deleted: "[D]",
};

const CHANGE_COLORS: Record<string, string> = {
  added: "text-green-600 dark:text-green-400",
  modified: "text-amber-600 dark:text-amber-400",
  deleted: "text-red-600 dark:text-red-400",
};

const FILE_STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",
  verified: "\u2713",
  failed: "\u2717",
};

const FILE_STATUS_COLORS: Record<string, string> = {
  pending: "text-gray-400",
  verified: "text-green-500",
  failed: "text-red-500",
};

/**
 * 交付物卡片组件
 * 渲染 AI 完成工作后的交付物：文件变更列表 + 校验结果 + 操作按钮
 */
export default function DeliverableCard({
  data,
  onAction,
  onEnterWorkMode,
  workModeReady,
}: DeliverableCardProps) {
  const { files, summary, checks, actions } = data;

  const handleAction = (action: string, file?: string) => {
    onAction?.(action, file);
  };

  return (
    <div className="my-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
      {/* 卡片标题栏 */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-1.5">
        <span className="text-sm flex-shrink-0">{"\u2705"}</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {summary}
        </span>
      </div>

      {/* 文件变更列表 */}
      {files.length > 0 && (
        <div className="px-3 py-2 space-y-1">
          {files.map((file, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span
                className={`flex-shrink-0 font-mono ${CHANGE_COLORS[file.change] || "text-gray-500"}`}
              >
                {CHANGE_LABELS[file.change] || file.change}
              </span>
              <span className="text-gray-700 dark:text-gray-300 font-mono truncate flex-1">
                {file.path}
              </span>
              <span
                className={`flex-shrink-0 ${FILE_STATUS_COLORS[file.status] || "text-gray-400"}`}
              >
                {FILE_STATUS_ICONS[file.status] || "\u25CB"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 校验结果 */}
      {checks && checks.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-50 dark:border-gray-700 space-y-1">
          {checks.map((check, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-xs">
              <span
                className={check.passed ? "text-green-500" : "text-red-500"}
              >
                {check.passed ? "\u2713" : "\u2717"}
              </span>
              <span className="text-gray-600 dark:text-gray-400">
                {check.name}
              </span>
              {check.detail && (
                <span className="text-gray-400 dark:text-gray-500 truncate">
                  {check.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      {actions && actions.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-2">
          {actions.map((action, idx) => (
            <button
              key={idx}
              onClick={() => handleAction(action.action, action.file)}
              className="px-2.5 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-600
                         bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300
                         hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* 进入工作模式按钮 */}
      {onEnterWorkMode && (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={onEnterWorkMode}
            disabled={workModeReady === false}
            className={`w-full px-3 py-1.5 text-xs rounded-lg transition-colors ${
              workModeReady === false
                ? "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white shadow-sm"
            }`}
            title={
              workModeReady === false
                ? "工作界面暂未就绪"
                : "进入工作界面查看文件变更详情"
            }
          >
            {workModeReady === false ? "工作界面暂未就绪" : "进入工作模式"}
          </button>
        </div>
      )}
    </div>
  );
}
