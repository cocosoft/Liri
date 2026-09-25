import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chat";
import { usePlanTaskStore } from "../../stores/planTaskStore";
// UI 期 UI-1（2026-09-23 修复计划 §十）：深度思考等待期的共享判定（原 DeepThinkingHint 组件）
import {
  useThinkingPhase,
  DEEP_THINKING_THRESHOLD_SECONDS,
} from "./useThinkingPhase";
import type { TaskCardData } from "../../types";
// 2026-09-25：任务卡快照取数抽为**单一来源**（本组件与 usePdcaStartEntry 共用）
import { findLatestTaskCard } from "./taskCardSnapshot";

const PHASE_LABELS: Record<string, string> = {
  analyzing: "chat.phaseAnalyzing",
  designing: "chat.phaseDesigning",
  implementing: "chat.phaseImplementing",
  verifying: "chat.phaseVerifying",
  presenting: "chat.phasePresenting",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "◌",
  in_progress: "→",
  completed: "✓",
  failed: "✗",
  cancelled: "⏹",
  blocked: "⊘",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-gray-400",
  in_progress: "text-blue-500",
  completed: "text-green-500",
  failed: "text-red-500",
  cancelled: "text-orange-500",
  blocked: "text-yellow-500",
};

/**
 * 任务进度显示组件
 */
function TaskProgress({ data }: { data: TaskCardData }) {
  const { t } = useTranslation();
  const total = data.tasks.length;
  const completed = data.tasks.filter((t) => t.status === "completed").length;
  const failed = data.tasks.filter((t) => t.status === "failed").length;

  if (total === 0) return null;

  return (
    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
      {t("chat.taskProgressCompleted", { completed, total })}
      {failed > 0 && (
        <span className="text-red-500 ml-1">
          | {t("chat.taskProgressFailed", { count: failed })}
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
  fluid,
}: {
  data: TaskCardData;
  onClose: () => void;
  fluid?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="absolute bottom-full left-0 right-0 px-3 pb-1"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-xl shadow-md p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {data.title}
            </span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              aria-label={t("chat.collapse")}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 15l7-7 7 7"
                />
              </svg>
            </button>
          </div>

          {data.tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 text-xs">
              <span
                className={`${STATUS_COLORS[task.status] || "text-gray-400"} font-mono w-4 text-center`}
              >
                {STATUS_ICONS[task.status] || "?"}
              </span>
              <span className="text-gray-600 dark:text-gray-300 flex-1 truncate">
                {task.name}
              </span>
              {task.status === "failed" && task.result && (
                <span
                  className="text-red-400 truncate max-w-[120px]"
                  title={task.result}
                >
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
export default function StatusFloatBar({
  fluid = false,
  pdca,
  orchestrate,
}: {
  fluid?: boolean;
  /** UI-2（2026-09-23）：PDCA 编排徽标（可见性/展开态由 ChatArea 与 usePdcaEntry 提供） */
  pdca?: { visible: boolean; open: boolean; onToggle: () => void };
  /** 「用编排推进（启动 PDCA）」入口（判据/动作由 ChatArea 与 usePdcaStartEntry 提供）：
   *  仅"存在未完成 todo 且尚无进行中 PDCA"时可见，与徽标互斥 */
  orchestrate?: {
    visible: boolean;
    count: number;
    starting: boolean;
    onStart: () => void;
  };
}) {
  const { t } = useTranslation();
  // UI-1（2026-09-23）：深度思考等待期 —— 与"正在生成/阶段"在**同一处**呈现，
  // 不再单独占输入框上方一行（用户诉求：零碎信息统一到浮动栏）
  const { phase: thinkingPhase, seconds: thinkingSeconds } = useThinkingPhase();
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

  /**
   * isActive 从 true → false 时渐隐：先 `opacity-0`（1s 过渡），2s 后置回 `fadingOut=false`
   * 让末尾 `if (!isActive && !fadingOut) return null` 生效、组件真正卸载。
   *
   * N-49 根因修复（2026-09-20）：本 effect 原先依赖 `[isActive, fadingOut]` —— 进入渐隐
   * （`fadingOut` 被置 true）会**重跑 effect**，而它的 cleanup 会把刚设好的 2 秒定时器清掉
   * ⇒ `fadingOut` **永久为 true** ⇒ 组件**永不卸载**：以 `opacity-0` 常驻 DOM（仍订阅 store、
   * 仍占位、仍可拦截指针事件，并曾让两次浏览器验证误判为"状态条仍在显示"）。
   * 故改为**只依赖 `isActive`**：cleanup 只在活跃态切换时清定时器，不再自清。
   */
  useEffect(() => {
    if (isActive) {
      setFadingOut(false);
      return;
    }
    setFadingOut(true);
    const timer = setTimeout(() => setFadingOut(false), 2000);
    return () => clearTimeout(timer);
  }, [isActive]);

  // BUG-9 修复（2026-08-23）：从 planTaskStore 订阅实时任务数据（SSE 驱动），
  // 与 TaskCard 组件同源；按消息中最后一个 planId 定位并优先取实时数据
  const planTasks = usePlanTaskStore((s) => s.tasks);
  const taskCard = useMemo(
    () => findLatestTaskCard(messages, planTasks),
    [messages, planTasks],
  );

  // UI-2（U2-a 裁决，2026-09-23）：有活跃 PDCA 事件时浮动栏**常驻** —— PDCA 任务可在
  // 流结束后继续跑，原 ChatPdcaDrawer 的独立入口行正为此而常驻；并入浮动栏后
  // 若仍只在 isActive 时渲染，会**丢失空闲态入口**（回归）。
  // 「用编排推进」入口同理：空闲且仍有未完成 todo 时常驻（否则入口无处可点）。
  if (!isActive && !fadingOut && !pdca?.visible && !orchestrate?.visible)
    return null;

  /**
   * 根据当前状态生成显示文本
   * 优先级：executionPhase > streamingStatus > 默认状态
   */
  const getStatusText = (): string => {
    // UI-2：空闲但仍有活跃 PDCA ⇒ 以"编排进行中"常驻；不得沿用"正在生成"（会谎报运行态）
    if (!isActive) {
      if (pdca?.visible) return t("chat.pdcaIdle");
      // 空闲且仅"用编排推进"入口常驻：左侧不谎报运行态也不与右侧入口文案重复，
      // 未完成进度由 TaskProgress（已完成 x/y）承担
      if (orchestrate?.visible) return "";
      return t("chat.streamingLabel");
    }
    if (isUploading) return t("chat.uploading");
    if (isSending && !isStreaming) return t("chat.sending");
    if (executionPhase?.phase) {
      const phaseLabel =
        t(PHASE_LABELS[executionPhase.phase]) || executionPhase.phase;
      return executionPhase.description
        ? `${phaseLabel} ${executionPhase.description}`
        : phaseLabel;
    }
    // UI-1（U1 裁决：executionPhase 优先，避免覆盖 PDCA 阶段）：深度思考等待期提示
    if (
      thinkingPhase === "thinking" &&
      thinkingSeconds >= DEEP_THINKING_THRESHOLD_SECONDS
    ) {
      return t("chat.deepThinkingHint", { seconds: thinkingSeconds });
    }
    if (streamingStatus) {
      // 精简上下文水位显示：仅取百分比，其余信息在 ContextWatermark hover 中查看
      // TODO: CS05-ROOTFIX — 正则解析为旧格式兜底；当前水位数据已走 contextWatermarkStore
      // 结构化字段（chat-stream-chunk context_state 分支），streamingStatus 不再承载水位文本
      const pctMatch = streamingStatus.match(/上下文水位:\s*(\d+)%/);
      if (pctMatch)
        return t("chat.statusContextWatermark", { pct: pctMatch[1] });
      return streamingStatus;
    }
    return t("chat.streamingLabel");
  };

  const statusText = getStatusText();

  return (
    <div className="w-full relative">
      <div
        className={`w-full px-3 transition-opacity duration-1000 ease-in-out ${fadingOut ? "opacity-0" : "opacity-100"}`}
        onClick={() => setShowTaskPanel(!showTaskPanel)}
      >
        <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200/50 dark:border-gray-700/50 rounded-xl shadow-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            {/* 状态指示点：绿色脉冲 = 运行中；空闲但 PDCA 常驻时用静态点（不谎报运行态） */}
            <span className="relative flex h-2.5 w-2.5">
              {isActive && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isActive ? "bg-green-500" : "bg-gray-400"
                }`}
              />
            </span>

            {/* 状态文本 + 任务进度 */}
            <div className="flex items-center flex-1 min-w-0">
              {statusText && (
                <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                  {statusText}
                </span>
              )}
              {taskCard && <TaskProgress data={taskCard} />}
            </div>

            {/* 「用编排推进」入口：存在未完成 todo 且尚无进行中 PDCA 时出现
                （与徽标互斥；stopPropagation 避免误触任务面板） */}
            {orchestrate?.visible && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  orchestrate.onStart();
                }}
                disabled={orchestrate.starting}
                aria-label={t("chat.pdcaSuggest")}
                title={t("chat.pdcaSuggestHint", { count: orchestrate.count })}
                className={`shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors ${
                  orchestrate.starting
                    ? "text-gray-400 dark:text-gray-500 cursor-default"
                    : "text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                }`}
              >
                <span>🧭</span>
                <span className="truncate max-w-[12rem]">
                  {t("chat.pdcaSuggest")}
                </span>
              </button>
            )}

            {/* UI-2：PDCA 编排徽标（点击展开/收起；stopPropagation 避免误触任务面板） */}
            {pdca?.visible && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  pdca.onToggle();
                }}
                aria-expanded={pdca.open}
                aria-label={t("chat.pdcaBadge")}
                title={t("chat.pdcaBadgeHint")}
                className={`shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors ${
                  pdca.open
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                <span>📊</span>
                <span>{t("chat.pdcaBadge")}</span>
              </button>
            )}

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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
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
                <svg
                  className="w-3.5 h-3.5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
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
        <TaskMiniPanel
          data={taskCard}
          onClose={() => setShowTaskPanel(false)}
          fluid={fluid}
        />
      )}
    </div>
  );
}
