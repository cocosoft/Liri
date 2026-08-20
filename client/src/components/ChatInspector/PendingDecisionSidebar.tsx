/**
 * PendingDecisionSidebar — 待确认清单侧栏（设计方案 §5 M3）
 *
 * 展示协商引擎中所有待用户确认的决策点：
 *  - 大纲确认（doc-workflow 阶段①）
 *  - 图片批量确认（doc-workflow 阶段②）
 *  - 选型确认（negotiation selection 信号）
 *  - 外部操作确认（negotiation external_action 信号）
 *
 * 嵌入 ChatInspector 作为新 Tab 或独立侧栏。
 */

import { useTranslation } from "react-i18next";

interface PendingDecision {
  id: string;
  type: "outline_confirm" | "image_batch" | "selection" | "external_action";
  title: string;
  description: string;
  /** 关联的阶段/工具名 */
  source: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 是否已过期 */
  expired?: boolean;
}

interface PendingDecisionSidebarProps {
  decisions: PendingDecision[];
  onResolve: (
    id: string,
    action: "confirm" | "reject",
    detail?: string,
  ) => void;
}

const TYPE_CONFIG = {
  outline_confirm: {
    icon: "📋",
    labelKey: "docWorkflow.outlineConfirm",
    color: "#7aa2f7",
  },
  image_batch: {
    icon: "🖼️",
    labelKey: "docWorkflow.imageBatchConfirm",
    color: "#bb9af7",
  },
  selection: {
    icon: "🔧",
    labelKey: "docWorkflow.selectionConfirm",
    color: "#e6c384",
  },
  external_action: {
    icon: "⚠️",
    labelKey: "docWorkflow.externalActionConfirm",
    color: "#f7768e",
  },
} as const;

function formatTime(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  return `${Math.floor(elapsed / 3_600_000)}h`;
}

export function PendingDecisionSidebar({
  decisions,
  onResolve,
}: PendingDecisionSidebarProps) {
  const { t } = useTranslation();

  const pending = decisions.filter((d) => !d.expired);
  const expired = decisions.filter((d) => d.expired);

  return (
    <div className="flex flex-col h-full">
      {/* 标题 */}
      <div className="px-3 py-2 border-b border-gray-700/30">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-200">
            🔔 {t("docWorkflow.pendingDecisions")}
          </span>
          {pending.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-mono">
              {pending.length}
            </span>
          )}
        </div>
      </div>

      {/* 待确认列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {pending.length === 0 && expired.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-600">
            <span className="text-2xl mb-2">✓</span>
            <span className="text-xs">
              {t("docWorkflow.noPendingDecisions")}
            </span>
          </div>
        )}

        {pending.map((decision) => {
          const config = TYPE_CONFIG[decision.type];
          return (
            <div
              key={decision.id}
              className="rounded-lg border bg-gray-800/40 overflow-hidden"
              style={{
                borderColor: `${config.color}30`,
              }}
            >
              {/* 卡片头部 */}
              <div
                className="flex items-center gap-2 px-3 py-2 border-b"
                style={{ borderColor: `${config.color}20` }}
              >
                <span className="text-sm">{config.icon}</span>
                <span className="text-xs font-medium text-gray-200 flex-1 truncate">
                  {decision.title}
                </span>
                <span className="text-xs text-gray-600">
                  {formatTime(decision.createdAt)}
                </span>
              </div>

              {/* 描述 */}
              <div className="px-3 py-2">
                <p className="text-xs text-gray-400 mb-1">
                  {decision.description}
                </p>
                <p className="text-xs text-gray-600">
                  {t("docWorkflow.source")}: {decision.source}
                </p>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-700/20">
                <button
                  onClick={() => onResolve(decision.id, "confirm")}
                  className="flex-1 px-2 py-1 text-xs rounded bg-green-700/40 hover:bg-green-700/60 text-green-300 transition-colors"
                >
                  {t("docWorkflow.confirm")}
                </button>
                <button
                  onClick={() => onResolve(decision.id, "reject")}
                  className="flex-1 px-2 py-1 text-xs rounded bg-red-700/40 hover:bg-red-700/60 text-red-300 transition-colors"
                >
                  {t("docWorkflow.reject")}
                </button>
              </div>
            </div>
          );
        })}

        {/* 已过期 */}
        {expired.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-600 px-1 py-1">
              {t("docWorkflow.expiredDecisions")} ({expired.length})
            </p>
            {expired.map((decision) => {
              const config = TYPE_CONFIG[decision.type];
              return (
                <div
                  key={decision.id}
                  className="flex items-center gap-2 px-2 py-1 opacity-50"
                >
                  <span className="text-xs">{config.icon}</span>
                  <span className="text-xs text-gray-500 flex-1 truncate line-through">
                    {decision.title}
                  </span>
                  <span className="text-xs text-gray-700">⏰</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export type { PendingDecision };
