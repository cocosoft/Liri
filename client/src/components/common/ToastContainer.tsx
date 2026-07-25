/**
 * ToastContainer — 全局 Toast 通知容器
 *
 * 固定在右下角，最多同时显示 3 条。
 * 每条可点击展开查看原始异常信息。
 */
import { useState } from "react";
import { useToastStore } from "../../stores/toastStore";

const COLORS = {
  error: {
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800/50",
    icon: "text-red-500",
    text: "text-red-700 dark:text-red-300",
    detail: "text-red-600 dark:text-red-400",
  },
  warning: {
    bg: "bg-yellow-50 dark:bg-yellow-950/40",
    border: "border-yellow-200 dark:border-yellow-800/50",
    icon: "text-yellow-500",
    text: "text-yellow-700 dark:text-yellow-300",
    detail: "text-yellow-600 dark:text-yellow-400",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    border: "border-blue-200 dark:border-blue-800/50",
    icon: "text-blue-500",
    text: "text-blue-700 dark:text-blue-300",
    detail: "text-blue-600 dark:text-blue-400",
  },
  success: {
    bg: "bg-green-50 dark:bg-green-950/40",
    border: "border-green-200 dark:border-green-800/50",
    icon: "text-green-500",
    text: "text-green-700 dark:text-green-300",
    detail: "text-green-600 dark:text-green-400",
  },
};

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (toasts.length === 0) return null;

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const c = COLORS[t.type];
        const isExpanded = expanded.has(t.id);
        return (
          <div
            key={t.id}
            className={`${c.bg} ${c.border} border rounded-lg px-3 py-2.5 shadow-lg cursor-pointer text-sm transition-all`}
            onClick={() => dismiss(t.id)}
            title="点击关闭"
          >
            <div className="flex items-start gap-2">
              <span className={c.icon + " flex-shrink-0 mt-0.5"}>
                {t.type === "error" ? "✕" : t.type === "warning" ? "!" : "i"}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`${c.text} text-xs font-medium leading-snug`}>
                  {t.message}
                </p>
                {t.detail && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(t.id);
                      }}
                      className={`text-[10px] mt-1 ${c.text} opacity-60 hover:opacity-100 underline`}
                    >
                      {isExpanded ? "收起详情" : "查看详情"}
                    </button>
                    {isExpanded && (
                      <p
                        className={`text-[10px] mt-1 whitespace-pre-wrap ${c.detail} opacity-70`}
                      >
                        {t.detail}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
