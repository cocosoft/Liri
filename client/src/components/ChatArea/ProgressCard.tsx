import type { ProgressData } from "../../types";

interface ProgressCardProps {
  data: ProgressData;
}

const PHASE_LABELS: Record<ProgressData["phase"], { icon: string; label: string }> = {
  analyzing:    { icon: "\u{1F50D}", label: "分析中" },
  designing:    { icon: "\u{1F3D7}\uFE0F", label: "设计中" },
  implementing: { icon: "\u{1F527}", label: "实现中" },
  verifying:    { icon: "\u2705", label: "验证中" },
  presenting:   { icon: "\u{1F4CB}", label: "展示结果" },
};

const STEP_STATUS_ICONS: Record<string, string> = {
  pending:     "\u25CB",
  in_progress: "\u27F3",
  done:        "\u2713",
  failed:      "\u2717",
};

const STEP_STATUS_COLORS: Record<string, string> = {
  pending:     "text-gray-400",
  in_progress: "text-blue-500",
  done:        "text-green-500",
  failed:      "text-red-500",
};

/**
 * 进度卡片组件
 * 渲染 AI 执行阶段的进度信息：阶段名 + 进度条 + 步骤列表 + 当前描述
 */
export default function ProgressCard({ data }: ProgressCardProps) {
  const { phase, progress, description, steps, currentStep } = data;
  const phaseInfo = PHASE_LABELS[phase] || { icon: "\u{1F4CC}", label: phase };

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
          {progress}%
        </span>
      </div>

      {/* 进度条 */}
      <div className="px-3 pt-2 pb-1">
        <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 步骤列表 */}
      {steps.length > 0 && (
        <div className="px-3 py-2 space-y-1">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className={`flex-shrink-0 ${STEP_STATUS_COLORS[step.status] || "text-gray-400"}`}>
                {STEP_STATUS_ICONS[step.status] || "\u25CB"}
              </span>
              <span className={`truncate ${
                step.status === "in_progress" ? "text-blue-600 dark:text-blue-400 font-medium" : "text-gray-600 dark:text-gray-400"
              }`}>
                {step.name}
              </span>
              {step.name === currentStep && (
                <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              )}
            </div>
          ))}
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