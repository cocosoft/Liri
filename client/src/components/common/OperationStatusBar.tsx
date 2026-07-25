import { useEffect } from "react";
import { useOperationProgressStore } from "../../stores/operationProgressStore";

/**
 * OperationStatusBar — 全局后台操作进度条
 *
 * 监听 SSE 事件，用一条简洁的状态栏展示所有正在进行的操作：
 * - 梦境周期（Gather → Analyze → Write → Index）
 * - 知识库编译
 * - 后台任务队列
 *
 * 无活跃操作时完全隐藏，不占空间。
 */
export function OperationStatusBar() {
  const operations = useOperationProgressStore((s) => s.operations);
  const init = useOperationProgressStore((s) => s._init);

  useEffect(() => {
    init();
  }, [init]);

  if (operations.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1 text-[11px] bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-100 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-300 overflow-x-auto">
      {operations.map((op) => (
        <span key={op.id} className="flex items-center gap-1 whitespace-nowrap">
          {op.progress !== undefined && op.progress < 1 ? (
            <span className="inline-block w-2.5 h-2.5 border-2 border-indigo-400 dark:border-indigo-500 border-t-transparent rounded-full animate-spin" />
          ) : op.progress === 1 ? (
            <span className="text-[10px]">✅</span>
          ) : null}
          {op.label}
          {op.progress !== undefined && op.progress < 1 && (
            <span className="opacity-60">{Math.round(op.progress * 100)}%</span>
          )}
        </span>
      ))}
    </div>
  );
}
