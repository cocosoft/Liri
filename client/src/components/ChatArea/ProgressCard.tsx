import { useTranslation } from "react-i18next";
import type { ProgressData } from "../../types";
import { getToolDisplayName } from "../../utils/toolHumanSummary";
// 2026-11-24（批次 5 / C2）：步骤状态图标/颜色的单一事实源（`done` 由 helper 归一）
import { getTaskStatusStyle } from "../../constants/taskStatus";
// 批次 4（2026-11-24）：执行阶段文案/图标的单一事实源（与 StatusFloatBar 共用）
import { getExecutionPhaseStyle } from "../../constants/executionPhase";

interface ProgressCardProps {
  data: ProgressData;
}

/** 滚动区高度上限（px）——命令过多时内部滚动，不撑高页面 */
const STEPS_MAX_HEIGHT = 176; // max-h-44

/**
 * 进度卡片组件
 * 渲染 AI 执行阶段的进度信息：阶段名 + 已完成工具数 + 步骤列表 + 当前描述
 *
 * 口径（批次 4，2026-11-24）：后端心跳的 `progress` 是**已完成工具调用数**
 * （`streamMessageToolLoop.buildExecutionPhaseChunk`），不是百分比。
 * 旧实现把它当 `%` 直接显示（37 次调用 ⇒ "37%"）并与"已执行 N 项"重复 ⇒
 * 现只显示计数，不再渲染百分比进度条（没有分母就不谎报比例）。
 *
 * 高度治理：步骤列表随命令累积只增不减，若不加限制会把页面撑得很高，
 * 因此步骤区设固定高度上限 + overflow-y 滚动。
 */
export default function ProgressCard({ data }: ProgressCardProps) {
  const { t } = useTranslation();
  const { phase, progress, description, steps, currentStep, truncated } = data;
  const phaseStyle = getExecutionPhaseStyle(phase);
  // 未识别阶段回退显示后端原始枚举值（不编造文案）
  const phaseIcon = phaseStyle?.icon ?? "\u{1F4CC}";
  const phaseLabel = phaseStyle ? t(phaseStyle.labelKey) : phase;
  // 已完成工具调用数（后端心跳语义；缺失/非法 ⇒ 0）
  const executedCount = Number.isFinite(progress) ? Math.max(0, progress) : 0;

  return (
    <div className="my-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
      {/* 卡片标题栏 */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm flex-shrink-0">{phaseIcon}</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {phaseLabel}
          </span>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
          {t("chat.progressExecutedCount", {
            count: executedCount,
            defaultValue: "已执行 {{count}} 项",
          })}
        </span>
      </div>

      {/* 步骤列表：高度上限 + 滚动（防止命令过多撑高页面） */}
      {steps.length > 0 && (
        <div className="px-3 py-2">
          {(truncated || steps.length > 6) && (
            <div className="flex items-center justify-end mb-1">
              {truncated ? (
                <span
                  className="text-[10px] text-gray-400 dark:text-gray-500"
                  title={t(
                    "chat.progressTruncatedHint",
                    "更早的记录已折叠，仅保留最近若干条以减少传输",
                  )}
                >
                  {t("chat.progressOnlyRecent", {
                    count: steps.length,
                    defaultValue: "仅展示最近 {{count}} 条",
                  })}
                </span>
              ) : (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {t("chat.progressScrollable", "可滚动查看")}
                </span>
              )}
            </div>
          )}
          <div
            className="space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.4)_transparent]"
            style={{ maxHeight: STEPS_MAX_HEIGHT }}
          >
            {steps.map((step, idx) => (
              // L1 修复（2026-08-23）：key 含步骤名——原 key={idx} 在 steps 截断
              // （slice(-30)）后 idx 归位，React 复用旧 DOM 对应新内容导致状态错位；
              // name+idx 组合保证截断后 key 变化触发重建，避免跨步骤复用。
              <div
                key={`${idx}-${step.name}`}
                className="flex items-center gap-2 text-xs"
              >
                {(() => {
                  const style = getTaskStatusStyle(step.status);
                  return (
                    <span className={`flex-shrink-0 ${style.color}`}>
                      {style.icon}
                    </span>
                  );
                })()}
                <span
                  className={`truncate ${
                    step.status === "in_progress"
                      ? "text-blue-600 dark:text-blue-400 font-medium"
                      : "text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {/* 修复 6（2026-08-25）：工具名转中文可读（如 todo_write → 待办写入），
                      currentStep 为工具名，比较仍用原始名保持匹配 */}
                  {getToolDisplayName(step.name)}
                </span>
                {step.name === currentStep && (
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 当前描述 */}
      {description && (
        <div className="px-3 pb-2 pt-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 italic truncate">
            {description}
          </p>
        </div>
      )}
    </div>
  );
}
