import type { ProgressData } from "../../types";
import { getToolDisplayName } from "../../utils/toolHumanSummary";

interface ProgressCardProps {
  data: ProgressData;
}

const PHASE_LABELS: Record<
  ProgressData["phase"],
  { icon: string; label: string }
> = {
  analyzing: { icon: "\u{1F50D}", label: "分析中" },
  designing: { icon: "\u{1F3D7}\uFE0F", label: "设计中" },
  implementing: { icon: "\u{1F527}", label: "实现中" },
  verifying: { icon: "\u2705", label: "验证中" },
  presenting: { icon: "\u{1F4CB}", label: "展示结果" },
};

const STEP_STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",
  in_progress: "\u27F3",
  done: "\u2713",
  failed: "\u2717",
};

const STEP_STATUS_COLORS: Record<string, string> = {
  pending: "text-gray-400",
  in_progress: "text-blue-500",
  done: "text-green-500",
  failed: "text-red-500",
  // S3 修复（2026-08-23）：cancelled 独立终态色（橙色"已取消"）
  cancelled: "text-orange-500",
};

/** 滚动区高度上限（px）——命令过多时内部滚动，不撑高页面 */
const STEPS_MAX_HEIGHT = 176; // max-h-44

/**
 * 进度卡片组件
 * 渲染 AI 执行阶段的进度信息：阶段名 + 进度条 + 步骤列表 + 当前描述
 *
 * 高度治理：步骤列表随命令累积只增不减，若不加限制会把页面撑得很高，
 * 因此步骤区设固定高度上限 + overflow-y 滚动。
 */
export default function ProgressCard({ data }: ProgressCardProps) {
  const {
    phase,
    progress,
    description,
    steps,
    currentStep,
    totalSteps,
    truncated,
  } = data;
  const phaseInfo = PHASE_LABELS[phase] || { icon: "\u{1F4CC}", label: phase };
  // BUG-1 修复（2026-08-23）：后端 execution_phase.progress 语义为"累计完成工具数"
  // （无总计划数分母，无法换算 0-100 百分比），此处 clamp 兜底防溢出（>100% 撑破容器）
  // 与 NaN 污染。见 dev_docs/20260823/会话标题生成问题-排查报告-20260823.md BUG-1。
  const clampedProgress = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress))
    : 0;

  return (
    <div className="my-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
      {/* 卡片标题栏 */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm flex-shrink-0">{phaseInfo.icon}</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {phaseInfo.label}
          </span>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
          {clampedProgress}%
        </span>
      </div>

      {/* 进度条 */}
      <div className="px-3 pt-2 pb-1">
        <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      </div>

      {/* 步骤列表：高度上限 + 滚动（防止命令过多撑高页面） */}
      {steps.length > 0 && (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              已执行 {totalSteps ?? steps.length} 项
            </span>
            {truncated ? (
              <span
                className="text-[10px] text-gray-400 dark:text-gray-500"
                title="更早的记录已折叠，仅保留最近若干条以减少传输"
              >
                仅展示最近 {steps.length} 条
              </span>
            ) : steps.length > 6 ? (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                可滚动查看
              </span>
            ) : null}
          </div>
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
                <span
                  className={`flex-shrink-0 ${STEP_STATUS_COLORS[step.status] || "text-gray-400"}`}
                >
                  {STEP_STATUS_ICONS[step.status] || "\u25CB"}
                </span>
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
