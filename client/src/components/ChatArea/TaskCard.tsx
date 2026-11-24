import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TaskCardData, TaskCardTask } from "../../types";
import { usePlanTaskStore } from "../../stores/planTaskStore";
import { useChatStore } from "../../stores/chat";
import { hasPendingApproval } from "../../stores/chat/chat-message-shared";
import DAGMiniMap from "./DAGMiniMap";
import DAGFullScreen from "./DAGFullScreen";
// 2026-11-24（批次 5 / C2）：状态图标/颜色/文案键的单一事实源
import { TASK_STATUS_STYLES } from "../../constants/taskStatus";

interface TaskCardProps {
  data: TaskCardData;
}

/** 2026-11-24（批次 5 / C2）：本表已收敛到 `constants/taskStatus`（别名保留调用点不动） */
const STATUS_CONFIG = TASK_STATUS_STYLES;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** 从 dependsOn 构建可读的依赖名列表（仅名称，文案由调用方 t() 包装） */
function resolveDepNames(
  dependsOn: string[],
  tasks: TaskCardTask[],
): string | null {
  if (dependsOn.length === 0) return null;
  return dependsOn
    .map((id) => tasks.find((t) => t.id === id)?.name || id)
    .join(", ");
}

export default function TaskCard({ data }: TaskCardProps) {
  const { t } = useTranslation();
  // P2（08-09）：当有 planId 时，从 planTaskStore 读取实时数据
  const liveData = usePlanTaskStore((s) =>
    data.planId ? s.tasks[data.planId] : null,
  );
  const merged = liveData ?? data;

  /**
   * 2026-11-13：**最后一张**任务卡在「等待审批」时不得渲染成完成态。
   *
   * 真机 `session_mwdcivrue74d4838ff`：审批卡在等用户点，任务卡却显示
   * 「已完成 x/y / 已结束」⇒ 用户以为任务跑完了。只有最新卡片叠加该状态，
   * 历史卡片保持它自己的结算态（否则回放里每张旧卡都会挂"等待审批"）。
   */
  const messages = useChatStore((s) => s.messages);
  const isLatestCard = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const blocks = messages[i].blocks ?? [];
      for (let j = blocks.length - 1; j >= 0; j--) {
        const card = blocks[j].taskCard;
        if (!card) continue;
        return card === data || (!!data.planId && card.planId === data.planId);
      }
    }
    return false;
  })();
  const pendingApproval = isLatestCard && hasPendingApproval(messages);

  const { title, tasks, status, acceptance } = merged;
  const isExecuting = status === "executing";
  /**
   * G5-D4（2026-11-18）：**已执行待验收**（后端 `Plan.acceptance='pending'`）。
   * 此时步骤通常全部完成、计划仍 running ⇒ 不能显示成普通"执行中"进度，
   * 也不能亮"全部完成"（目标门尚未给结论）。
   */
  const isPendingAcceptance = isExecuting && acceptance === "pending";
  // 修复："全部完成"徽章仅当任务级**全部** completed 时显示——
  // 原实现只看卡片级 status==="done"，与 freezeAll 一刀切 done 叠加后，
  // 中止/含 failed 的任务卡也亮"全部完成"徽章，与任务列表状态自相矛盾。
  const isAllCompleted =
    status === "done" &&
    tasks.length > 0 &&
    tasks.every((t) => t.status === "completed");
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const hasDependencies = tasks.some((t) => t.dependsOn.length > 0);
  const [expanded, setExpanded] = useState(false);
  const [showDAG, setShowDAG] = useState(false);
  const [showFullDAG, setShowFullDAG] = useState(false);

  return (
    <div
      className={`my-2 rounded-xl bg-white dark:bg-gray-800 overflow-hidden border ${
        expanded
          ? "border-gray-200 dark:border-gray-700 shadow-sm"
          : "border-gray-200/70 dark:border-gray-700/70"
      }`}
    >
      {/* 卡片标题栏（兼作展开/收起开关，默认折叠为一行摘要） */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-3 flex items-center justify-between text-left cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
          expanded
            ? "py-2 border-b border-gray-100 dark:border-gray-700"
            : "py-1.5"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm flex-shrink-0">📋</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {t("chat.taskBreakdown", {
              title,
              defaultValue: "任务分解：{{title}}",
            })}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/*
            2026-11-17（用户实测：审批过期后仍常驻「等待审批」）：
            徽标只认**真实待审批**（`hasPendingApproval` 按 inboxId 与审批卡对账）。
            历史上的 `status === "paused"` 会在任务以失败/中止收尾后永久残留
            （真机：失败回执已出，卡片仍写"等待审批"）⇒ 不再单独触发徽标；
            无待审批的 paused 卡按「已结束」结算呈现，不再谎报在等。
          */}
          {pendingApproval ? (
            <span className="text-xs px-2 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full">
              {t("chat.taskPaused", "⏸ 等待审批（需要你的反馈）")}
            </span>
          ) : (
            <>
              {isAllCompleted && (
                <span className="text-xs px-2 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
                  {t("chat.allCompleted", "全部完成")}
                </span>
              )}
              {(status === "done" || status === "paused") &&
                !isAllCompleted && (
                  <span className="text-xs px-2 py-0.5 bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full">
                    {failed > 0
                      ? t("chat.taskEndedWithFailed", {
                          count: failed,
                          defaultValue: "已结束（{{count}} 失败）",
                        })
                      : t("chat.taskEnded", "已结束")}
                  </span>
                )}
              {/* G5-D4：已执行待验收 —— 不能显示成普通"执行中/已完成" */}
              {isPendingAcceptance && (
                <span className="text-xs px-2 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full">
                  {t("chat.taskPendingAcceptance", {
                    completed,
                    total,
                    defaultValue: "⏸ 待验收（已完成 {{completed}}/{{total}}）",
                  })}
                </span>
              )}
              {isExecuting && !isPendingAcceptance && (
                <span className="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full">
                  {t("chat.taskProgressCompleted", {
                    completed,
                    total,
                    defaultValue: "已完成 {{completed}}/{{total}}",
                  })}
                  {failed > 0 &&
                    `, ${t("chat.taskProgressFailed", {
                      count: failed,
                      defaultValue: "失败 {{count}}",
                    })}`}
                </span>
              )}
            </>
          )}
          <span
            className={`text-xs text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          >
            ▼
          </span>
        </div>
      </button>

      {/* 展开后：任务列表 + DAG 依赖图 */}
      {expanded && (
        <>
          <div className="px-3 py-1.5 space-y-1">
            {tasks.map((task, index) => {
              const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
              const deps = resolveDepNames(task.dependsOn, tasks);

              return (
                <div
                  key={task.id}
                  className={`flex items-center gap-1.5 py-1 px-1.5 rounded-lg transition-colors ${
                    task.status === "in_progress"
                      ? "bg-blue-50 dark:bg-blue-900/20"
                      : task.status === "completed"
                        ? "bg-green-50/50 dark:bg-green-900/10"
                        : task.status === "failed"
                          ? "bg-red-50/50 dark:bg-red-900/10"
                          : ""
                  }`}
                >
                  {/* 序号 + 状态图标 */}
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-3 flex-shrink-0 text-right">
                    {index + 1}.
                  </span>
                  <span className={`text-xs flex-shrink-0 ${cfg.color}`}>
                    {cfg.icon}
                  </span>

                  {/* 任务名称 */}
                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0">
                    {task.name}
                  </span>

                  {/* 状态标签或被阻塞的原因 */}
                  {task.status === "blocked" && deps ? (
                    <span className="text-xs text-orange-500 dark:text-orange-400 truncate flex-shrink-0 max-w-[160px]">
                      {t("chat.taskWaitingDeps", {
                        names: deps,
                        defaultValue: "等待: {{names}}",
                      })}
                    </span>
                  ) : task.status === "in_progress" ? (
                    <span className="text-xs text-blue-500 dark:text-blue-400 flex-shrink-0">
                      {t(cfg.labelKey)}
                    </span>
                  ) : task.durationMs !== undefined ? (
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {formatDuration(task.durationMs)}
                    </span>
                  ) : (
                    <span className={`text-xs ${cfg.color} flex-shrink-0`}>
                      {t(cfg.labelKey)}
                    </span>
                  )}

                  {/* 结果指示 */}
                  {task.status === "completed" && task.result && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate flex-shrink-0 max-w-[120px]">
                      {task.result}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* DAG 依赖图（有依赖关系时展示） */}
          {hasDependencies && (
            <div className="border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => setShowDAG(!showDAG)}
                className="w-full px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors flex items-center gap-1 justify-center"
              >
                <span>{showDAG ? "▲" : "▼"}</span>
                <span>
                  {t("chat.taskViewGraph", {
                    nodes: tasks.filter((t) => t.dependsOn.length > 0).length,
                    edges: tasks.reduce(
                      (sum, t) => sum + t.dependsOn.length,
                      0,
                    ),
                    defaultValue:
                      "查看依赖关系图（{{nodes}} 个节点, {{edges}} 条边）",
                  })}
                </span>
              </button>
              {showDAG && (
                <div className="px-2 pb-2">
                  <DAGMiniMap
                    tasks={tasks}
                    height={200}
                    onExpand={() => setShowFullDAG(true)}
                  />
                </div>
              )}
            </div>
          )}

          {/* 全屏 DAG 弹窗 */}
          {showFullDAG && (
            <DAGFullScreen
              tasks={tasks}
              title={title}
              onClose={() => setShowFullDAG(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
