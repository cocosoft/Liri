/**
 * WorkflowRunCard — 工作流 run 聚合卡片（P1-3 §12 D14，2026-10-05 实建）
 *
 * 把 4 类持久事件（`workflow_run_start` / `workflow_step_start` / `workflow_step_end` /
 * `workflow_run_end`）聚合为**一张**卡片（不再各产一条 status 提示行）：
 *  - run 头：工作流名 / 状态 / 总耗时 / 已完成步骤计数
 *  - 步骤列表：状态图标 / 描述（回退工具名）/ 耗时 / 步骤级错误；超过 6 条内部滚动
 *  - 结论行：失败 / 取消 / 中断原因（中断文案由后端重放期合成，D16）
 *
 * 标签硬编码中文（D17：与 ProgressCard / StatusBlock 等既有卡片惯例一致，不引入 i18n）。
 * 数据来自真实事件聚合（CS04：无 mock）；缺字段即省略，不编造（CS06）。
 */

import { useState } from "react";
import type {
  WorkflowRunData,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
} from "../../types/message";

const RUN_STATUS_ICON: Record<WorkflowRunStatus, string> = {
  running: "▶",
  completed: "✔",
  failed: "✖",
  cancelled: "■",
  interrupted: "⚠",
};

const RUN_STATUS_LABEL: Record<WorkflowRunStatus, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

const RUN_STATUS_CLASS: Record<WorkflowRunStatus, string> = {
  running: "text-blue-600 dark:text-blue-400",
  completed: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
  cancelled: "text-gray-500 dark:text-gray-400",
  interrupted: "text-amber-600 dark:text-amber-400",
};

const STEP_STATUS_ICON: Record<WorkflowRunStepStatus, string> = {
  pending: "○",
  running: "▶",
  completed: "✔",
  failed: "✖",
  cancelled: "■",
  interrupted: "⚠",
};

const STEP_STATUS_CLASS: Record<WorkflowRunStepStatus, string> = {
  pending: "text-gray-400 dark:text-gray-500",
  running: "text-blue-600 dark:text-blue-400",
  completed: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
  cancelled: "text-gray-500 dark:text-gray-400",
  interrupted: "text-amber-600 dark:text-amber-400",
};

/** 步骤列表内部滚动阈值（超过则限高滚动，避免长工作流撑爆气泡） */
const VISIBLE_STEP_LIMIT = 6;

/** 耗时格式化：<1s 显示 ms，否则保留一位小数秒 */
function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

interface WorkflowRunCardProps {
  data: WorkflowRunData;
}

export default function WorkflowRunCard({ data }: WorkflowRunCardProps) {
  const [expanded, setExpanded] = useState(true);

  const totalSteps = data.steps.length;
  const doneSteps = data.steps.filter((s) => s.status === "completed").length;
  const scrollable = totalSteps > VISIBLE_STEP_LIMIT;

  // 结论行（D16：中断文案由后端合成；缺字段则省略，不编造 —— CS06）
  let conclusion: string | undefined;
  if (data.status === "failed") {
    const where = data.failedStep
      ? `失败于步骤 ${data.failedStep}`
      : "执行失败";
    conclusion = data.error ? `${where}：${data.error}` : where;
    if (data.rootCauseSummary) conclusion += `｜${data.rootCauseSummary}`;
  } else if (data.status === "cancelled") {
    conclusion = "运行已取消";
  } else if (data.status === "interrupted") {
    conclusion = data.interruptedHint ?? "执行中断，运行结果未知";
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/30 overflow-hidden max-w-xl w-full">
      {/* 头部：工作流名 + 状态 + 耗时 + 步骤计数 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-sm flex-shrink-0 ${RUN_STATUS_CLASS[data.status]}`}
          >
            {RUN_STATUS_ICON[data.status]}
          </span>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
            {data.workflow}
          </span>
          <span
            className={`text-xs flex-shrink-0 ${RUN_STATUS_CLASS[data.status]}`}
          >
            {RUN_STATUS_LABEL[data.status]}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {data.durationMs !== undefined && (
            <span className="text-xs text-gray-500 font-mono">
              {formatDuration(data.durationMs)}
            </span>
          )}
          <span className="text-xs text-gray-500 font-mono">
            {doneSteps}/{totalSteps}
          </span>
          <span className="text-gray-500 text-xs">{expanded ? "▼" : "▶"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {totalSteps === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">
              无步骤记录
            </p>
          ) : (
            <div
              className={
                scrollable ? "space-y-1 max-h-56 overflow-y-auto" : "space-y-1"
              }
            >
              {data.steps.map((step) => (
                <div
                  key={step.stepId}
                  className="flex items-start gap-2 text-xs"
                >
                  <span
                    className={`flex-shrink-0 ${STEP_STATUS_CLASS[step.status]}`}
                  >
                    {STEP_STATUS_ICON[step.status]}
                  </span>
                  {/* 步骤描述/工具名作为 flex 子项（min-w-0）才能让 truncate 生效 */}
                  <span className="text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">
                    {step.description || step.tool}
                  </span>
                  {step.synthesized && (
                    <span className="text-amber-600 dark:text-amber-400 flex-shrink-0">
                      强制结算
                    </span>
                  )}
                  {step.durationMs !== undefined && (
                    <span className="text-gray-400 dark:text-gray-400 font-mono flex-shrink-0">
                      {formatDuration(step.durationMs)}
                    </span>
                  )}
                  {step.error && (
                    <span
                      className="text-red-500 dark:text-red-400 flex-shrink-0 max-w-[50%] truncate"
                      title={step.error}
                    >
                      {step.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {conclusion && (
            <div className="flex items-start gap-2 px-3 py-1.5 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30">
              <span className="text-xs">⚠️</span>
              <span className="text-xs text-amber-700 dark:text-amber-300">
                {conclusion}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
