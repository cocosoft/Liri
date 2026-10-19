/**
 * G-10 P3（2026-10-19）：主动消息卡片（本地 UI）。
 *
 * 纯展示组件：只接收已清洗的标题/正文与白名单动作；不执行命令、不读写网络。
 * 由 `NotificationPanel` 在 `source === 'proactive'` 时渲染（见 P3 集成）。
 */
import { useTranslation } from "react-i18next";

export type ProactiveCardPriority = "low" | "normal" | "high" | "critical";

export interface ProactiveCardAction {
  /** 动作幂等键（回调时原样返回） */
  id: string;
  label: string;
}

export interface ProactiveMessageCardProps {
  title: string;
  /** 纯文本 / Markdown 子集；按文本渲染（不做 HTML 注入） */
  body: string;
  priority: ProactiveCardPriority;
  actions?: ProactiveCardAction[];
  onAction?: (actionId: string) => void;
  onDismiss?: () => void;
  className?: string;
}

const PRIORITY_STYLES: Record<
  ProactiveCardPriority,
  { bar: string; badge: string }
> = {
  critical: {
    bar: "bg-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  high: {
    bar: "bg-amber-500",
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  normal: {
    bar: "bg-blue-500",
    badge:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  low: {
    bar: "bg-gray-300 dark:bg-gray-600",
    badge: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  },
};

export default function ProactiveMessageCard({
  title,
  body,
  priority,
  actions,
  onAction,
  onDismiss,
  className = "",
}: ProactiveMessageCardProps) {
  const { t } = useTranslation();
  const styles = PRIORITY_STYLES[priority];

  return (
    <div
      data-testid="proactive-message-card"
      data-priority={priority}
      className={`relative flex gap-3 p-3.5 rounded-lg bg-white dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50 ${className}`}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg ${styles.bar}`}
      />
      <div className="flex-1 min-w-0 ml-0.5">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${styles.badge}`}
          >
            {priority.toUpperCase()}
          </span>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
            {title}
          </span>
        </div>

        {body && (
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed whitespace-pre-wrap break-words">
            {body}
          </p>
        )}

        {((actions && actions.length > 0) || onDismiss) && (
          <div className="flex items-center gap-2 mt-2">
            {actions?.map((action) => (
              <button
                key={action.id}
                type="button"
                data-action-id={action.id}
                onClick={() => onAction?.(action.id)}
                className="text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              >
                {action.label}
              </button>
            ))}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t("common.delete")}
                title={t("common.delete")}
                className="ml-auto text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
