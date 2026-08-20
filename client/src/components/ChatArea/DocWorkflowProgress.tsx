/**
 * DocWorkflowProgress — 分阶段文档工作流进度面板（设计方案 §4 M3）
 *
 * 三阶段可视化：
 *  ① 大纲整理（outline）：生成结构化大纲 → 等待用户确认
 *  ② 内容填充 + 配图（filling）：逐节点填充正文 + 生成图片
 *  ③ 成稿（compose）：占位符替换 → 输出文件
 *
 * 视觉风格对齐 TaskCard：折叠/展开、阶段图标、进度条、节点列表。
 */

import { useState } from "react";
import type { DocWorkflowProgressData } from "../../types/message";
import { useTranslation } from "react-i18next";

interface DocWorkflowProgressProps {
  data: DocWorkflowProgressData;
  isStreaming?: boolean;
}

const STAGE_CONFIG = {
  outline: {
    icon: "📋",
    labelKey: "docWorkflow.stageOutline",
    color: "#7aa2f7",
  },
  filling: {
    icon: "✍️",
    labelKey: "docWorkflow.stageFilling",
    color: "#bb9af7",
  },
  compose: {
    icon: "📦",
    labelKey: "docWorkflow.stageCompose",
    color: "#9ece6a",
  },
} as const;

const STATUS_ICON: Record<string, string> = {
  pending: "⏳",
  in_progress: "🔵",
  awaiting_confirm: "⏸️",
  completed: "✅",
  failed: "❌",
};

const NODE_STATUS_ICON: Record<string, string> = {
  pending: "⏳",
  in_progress: "🔵",
  completed: "✅",
  failed: "❌",
};

export function DocWorkflowProgress({
  data,
  isStreaming,
}: DocWorkflowProgressProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const stages = ["outline", "filling", "compose"] as const;
  const currentStageConfig = STAGE_CONFIG[data.currentStage];

  // 计算总进度
  const stageValues = stages.map((s) => data.stages[s]);
  const completedStages = stageValues.filter(
    (s) => s.status === "completed",
  ).length;
  const totalProgress = Math.round((completedStages / 3) * 100);

  // 全部完成
  const allCompleted = completedStages === 3;
  const hasFailed = stageValues.some((s) => s.status === "failed");

  return (
    <div
      className="rounded-lg border border-gray-700/50 bg-gray-800/30 overflow-hidden"
      style={{ maxWidth: "600px" }}
    >
      {/* 头部：标题 + 总进度 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm flex-shrink-0">
            {allCompleted
              ? "✅"
              : hasFailed
                ? "❌"
                : isStreaming
                  ? currentStageConfig.icon
                  : "📄"}
          </span>
          <span className="text-sm font-medium text-gray-200 truncate">
            📝 {data.title}
          </span>
          <span className="text-xs text-gray-500 flex-shrink-0">
            {data.format.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-xs px-1.5 py-0.5 rounded font-mono"
            style={{
              color: allCompleted
                ? "#9ece6a"
                : hasFailed
                  ? "#f7768e"
                  : "#e6c384",
            }}
          >
            {totalProgress}%
          </span>
          <span className="text-xs text-gray-500">{completedStages}/3</span>
          <span className="text-gray-500 text-xs">{expanded ? "▼" : "▶"}</span>
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {/* 三阶段进度条 */}
          <div className="flex items-center gap-1 py-2">
            {stages.map((stage, idx) => {
              const stageData = data.stages[stage];
              const config = STAGE_CONFIG[stage];
              const isActive = data.currentStage === stage;
              const isDone = stageData.status === "completed";
              const isFailed = stageData.status === "failed";

              return (
                <div key={stage} className="flex items-center flex-1">
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                    style={{
                      backgroundColor: isActive
                        ? `${config.color}20`
                        : "transparent",
                      border: `1px solid ${
                        isDone
                          ? "#9ece6a40"
                          : isFailed
                            ? "#f7768e40"
                            : isActive
                              ? `${config.color}40`
                              : "#333"
                      }`,
                    }}
                  >
                    <span>
                      {isDone
                        ? "✅"
                        : isFailed
                          ? "❌"
                          : isActive
                            ? "🔵"
                            : config.icon}
                    </span>
                    <span
                      className="text-xs"
                      style={{
                        color: isActive ? config.color : "#888",
                      }}
                    >
                      {t(config.labelKey)}
                    </span>
                    {stageData.progress !== undefined && isActive && (
                      <span className="text-xs text-gray-500 font-mono">
                        {stageData.progress}%
                      </span>
                    )}
                  </div>
                  {idx < 2 && (
                    <div
                      className="flex-1 h-px mx-1"
                      style={{
                        backgroundColor: isDone ? "#9ece6a40" : "#333",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* 各阶段详情 */}
          {stages.map((stage) => {
            const stageData = data.stages[stage];
            if (stageData.status === "pending") return null;

            return (
              <div
                key={stage}
                className="rounded border border-gray-700/30 bg-gray-900/30 px-3 py-2"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-300">
                    {STAGE_CONFIG[stage].icon} {t(STAGE_CONFIG[stage].labelKey)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {STATUS_ICON[stageData.status]} {stageData.status}
                  </span>
                </div>

                {stageData.description && (
                  <p className="text-xs text-gray-400 mb-1">
                    {stageData.description}
                  </p>
                )}

                {/* 节点级进度（大纲/填充阶段） */}
                {stageData.nodes && stageData.nodes.length > 0 && (
                  <div className="space-y-0.5 mt-1">
                    {stageData.nodes.map((node) => (
                      <div
                        key={node.id}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="text-gray-500">
                          {NODE_STATUS_ICON[node.status]}
                        </span>
                        <span className="text-gray-300 truncate flex-1">
                          {node.title}
                        </span>
                        {node.hasImage && (
                          <span className="text-xs text-purple-400">🖼️</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* 输出文件路径 */}
          {data.outputFilePath && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-green-900/20 border border-green-700/30">
              <span className="text-xs">📎</span>
              <span className="text-xs text-green-400 truncate">
                {data.outputFilePath}
              </span>
            </div>
          )}

          {/* 错误信息 */}
          {data.error && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-900/20 border border-red-700/30">
              <span className="text-xs">⚠️</span>
              <span className="text-xs text-red-400">{data.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
