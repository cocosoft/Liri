/**
 * TaskHistory
 * 任务执行历史折叠面板（P2-10）
 * 点击历史记录项 → 自动填充回工具面板
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getHistory, clearHistory, type TaskHistory } from "./taskHistoryStore";
import { TOOL_REGISTRY } from "./toolRegistry";

interface Props {
  onResume: (toolName: string, args: Record<string, unknown>) => void;
}

/** 格式化时间 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 格式化时长 */
function formatDuration(startedAt: number, completedAt: number): string {
  const ms = completedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

export default function TaskHistoryPanel({ onResume }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<TaskHistory[]>(getHistory);

  const handleClear = () => {
    clearHistory();
    setItems([]);
  };

  const handleResume = (item: TaskHistory) => {
    onResume(item.toolName, item.args);
  };

  const toolLabel = (name: string) => {
    const reg = TOOL_REGISTRY[name];
    return reg ? t(reg.entry.labelKey) : name;
  };

  // 生成参数的简短摘要
  const argSummary = (args: Record<string, unknown>): string => {
    const prompt = args.prompt as string;
    if (prompt) return prompt.slice(0, 30) + (prompt.length > 30 ? "..." : "");
    const action = args.action as string;
    if (action) return action;
    return JSON.stringify(args).slice(0, 30);
  };

  const refresh = () => setItems(getHistory());

  return (
    <div className="border-t border-gray-700/20 pt-3">
      {/* 使用 div+role="button" 代替 button，避免内层清除按钮嵌套在 button 内违反 HTML 规范 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!expanded) refresh();
          setExpanded(!expanded);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!expanded) refresh(); setExpanded(!expanded); } }}
        className="flex items-center gap-1 w-full text-left text-xs text-gray-400 hover:text-gray-300 bg-transparent cursor-pointer"
      >
        <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
        <span>{t("image.history")}</span>
        <span className="text-gray-600 ml-0.5">({items.length})</span>
        {items.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); handleClear(); }}
            className="ml-auto text-[9px] text-gray-600 hover:text-red-400 bg-transparent border-0 cursor-pointer"
          >
            {t("image.clearHistory")}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-2 space-y-0.5 max-h-[200px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-[10px] text-gray-600 italic">
              {t("image.noHistory")}
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                onClick={() => handleResume(item)}
                className="flex items-center gap-1.5 w-full text-left text-[10px] py-1 px-1.5 rounded hover:bg-gray-700/40 bg-transparent border-0 cursor-pointer"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    item.success ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-gray-500 shrink-0 w-14 text-right">
                  {formatTime(item.startedAt)}
                </span>
                <span className="text-gray-400 shrink-0 w-10">{toolLabel(item.toolName)}</span>
                <span className="text-gray-500 truncate text-right ml-auto">
                  {argSummary(item.args)}
                </span>
                <span className="text-gray-600 shrink-0 text-[9px]">
                  {formatDuration(item.startedAt, item.completedAt)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
