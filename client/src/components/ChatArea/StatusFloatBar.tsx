import { useState, useMemo, useEffect, useRef } from "react";
import { useChatStore } from "../../stores/chatStore";
import type { TaskCardData } from "../../types";

const PHASE_LABELS: Record<string, string> = {
  analyzing:    "正在分析代码...",
  designing:    "正在设计方案...",
  implementing: "正在实施变更...",
  verifying:    "正在验证结果...",
  presenting:   "正在生成报告...",
};

const STATUS_ICONS: Record<string, string> = {
  pending:     "◌",
  in_progress: "→",
  completed:   "✓",
  failed:      "✗",
  blocked:     "⊘",
};

const STATUS_COLORS: Record<string, string> = {
  pending:     "text-gray-400",
  in_progress: "text-blue-500",
  completed:   "text-green-500",
  failed:      "text-red-500",
  blocked:     "text-yellow-500",
};

/**
 * 从消息中提取最新的 TaskCard（遍历所有消息的 blocks 寻找最后一个 todo 块）
 */
function findLatestTaskCard(messages: any[]): TaskCardData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = messages[i].blocks;
    if (!blocks) continue;
    for (let j = blocks.length - 1; j >= 0; j--) {
      if (blocks[j].taskCard) {
        return blocks[j].taskCard as TaskCardData;
      }
    }
  }
  return null;
}

/**
 * 任务进度显示组件
 */
function TaskProgress({ data }: { data: TaskCardData }) {
  const total = data.tasks.length;
  const completed = data.tasks.filter((t) => t.status === "completed").length;
  const failed = data.tasks.filter((t) => t.status === "failed").length;

  if (total === 0) return null;

  return (
    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
      {completed}/{total} 任务已完成
      {failed > 0 && (
        <span className="text-red-500 ml-1">
          | {failed} 失败
        </span>
      )}
    </span>
  );
}

/**
 * 任务进度 Mini 面板（点击展开）
 */
function TaskMiniPanel({
  data,
  onClose,
}: {
  data: TaskCardData;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-[132px] left-0 right-0 px-3 z-10" onClick={(e) => e.stopPropagation()}>
      <div className="max-w-3xl mx-auto">
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-xl shadow-md p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {data.title}
            </span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              aria-label="收起"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>

          {data.tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 text-xs"
            >
              <span className={`${STATUS_COLORS[task.status] || "text-gray-400"} font-mono w-4 text-center`}>
                {STATUS_ICONS[task.status] || "?"}
              </span>
              <span className="text-gray-600 dark:text-gray-300 flex-1 truncate">
                {task.name}
              </span>
              {task.status === "failed" && task.result && (
                <span className="text-red-400 truncate max-w-[120px]" title={task.result}>
                  {task.result}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 运行状态浮动面板（增强版）
 *
 * 浮于 ChatArea 消息列表与 ChatInput 输入区之间，展示当前会话的运行状态。
 * - 运行中：绿色脉冲点 + 状态描述文本 + 任务进度
 * - 空闲：不渲染
 * - 执行阶段：读取 executionPhase，优先显示阶段文本
 * - 任务进度：从最后一条 assistant 消息的 todo 块中提取，显示完成数/总数
 * - 点击任务进度可展开 Mini 面板查看具体任务状态
 */
export default function StatusFloatBar() {
  const isSending = useChatStore((s) => s.isSending);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isUploading = useChatStore((s) => s.isUploading);
  const streamingStatus = useChatStore((s) => s.streamingStatus);
  const executionPhase = useChatStore((s) => s.executionPhase);
  const messages = useChatStore((s) => s.messages);
  const stopMessage = useChatStore((s) => s.stopMessage);

  const [showTaskPanel, setShowTaskPanel] = useState(false);

  const isActive = isSending || isStreaming || isUploading;
  const [fadingOut, setFadingOut] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // isActive 从 true → false 时触发渐隐动画，2秒后真正隐藏
  useEffect(() => {
    if (!isActive && !fadingOut) {
      setFadingOut(true);
      fadeTimerRef.current = setTimeout(() => {
        setFadingOut(false);
      }, 2000);
    } else if (isActive && fadingOut) {
      // 活跃状态恢复时立即取消渐隐
      setFadingOut(false);
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    }
    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [isActive, fadingOut]);

  // 从消息中提取最新的 TaskCard（必须放在所有 return 之前，遵守 Hooks 规则）
  const taskCard = useMemo(() => findLatestTaskCard(messages), [messages]);

  if (!isActive && !fadingOut) return null;

  /**
   * 根据当前状态生成显示文本
   * 优先级：executionPhase > streamingStatus > 默认状态
   */
  const getStatusText = (): string => {
    if (isUploading) return "正在上传文件...";
    if (isSending && !isStreaming) return "正在发送...";
    if (executionPhase?.phase) {
      const phaseLabel = PHASE_LABELS[executionPhase.phase] || executionPhase.phase;
      return executionPhase.description
        ? `${phaseLabel} ${executionPhase.description}`
        : phaseLabel;
    }
    if (streamingStatus) return streamingStatus;
    return "AI 正在回复...";
  };

  return (
    <>
      <div
        className={`absolute bottom-[88px] left-0 right-0 px-3 transition-opacity duration-1000 ease-in-out z-10 ${fadingOut ? 'opacity-0' : 'opacity-100'}`}
        onClick={() => setShowTaskPanel(!showTaskPanel)}
      >
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-xl shadow-md cursor-pointer hover:bg-white/90 dark:hover:bg-gray-800/90 transition-colors">
            {/* 状态指示点：绿色脉冲 = 运行中 */}
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>

            {/* 状态文本 + 任务进度 */}
            <div className="flex items-center flex-1 min-w-0">
              <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                {getStatusText()}
              </span>
              {taskCard && <TaskProgress data={taskCard} />}
            </div>

            {/* 任务进度展开指示 */}
            {taskCard && (
              <svg
                className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                  showTaskPanel ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}

            {/* 停止按钮：仅流式输出中显示 */}
            {isStreaming && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  stopMessage();
                }}
                aria-label="停止 AI 回复"
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                title="停止 AI 回复"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                <span>停止</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 展开的 Mini 面板 */}
      {showTaskPanel && taskCard && (
        <TaskMiniPanel data={taskCard} onClose={() => setShowTaskPanel(false)} />
      )}
    </>
  );
}
