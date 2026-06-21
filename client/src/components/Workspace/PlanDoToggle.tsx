interface PlanDoToggleProps {
  mode: "plan" | "do";
  onToggle: (mode: "plan" | "do") => void;
  disabled?: boolean;
}

/**
 * Plan/Do 模式切换标签组件
 * 显示在右侧对话区顶部，支持 Plan（方案讨论）与 Do（执行变更）模式切换
 * AI 执行中（executionPhase 非空）时禁用切换
 */
export default function PlanDoToggle({ mode, onToggle, disabled }: PlanDoToggleProps) {
  return (
    <div className="flex items-center border-b border-gray-200 dark:border-gray-700 px-2 py-1.5 gap-1">
      <span className="text-xs text-gray-500 dark:text-gray-400 mr-1 flex-shrink-0">
        模式：
      </span>
      <button
        className={`px-3 py-1 text-xs rounded-l-md transition-colors ${
          mode === "plan"
            ? "bg-blue-500 text-white shadow-sm"
            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        }`}
        onClick={() => onToggle("plan")}
        disabled={disabled}
        title="方案讨论模式：AI 分析、设计，不写文件"
      >
        Plan
      </button>
      <button
        className={`px-3 py-1 text-xs rounded-r-md transition-colors ${
          mode === "do"
            ? "bg-green-500 text-white shadow-sm"
            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        }`}
        onClick={() => onToggle("do")}
        disabled={disabled}
        title="执行变更模式：AI 实施代码变更"
      >
        Do
      </button>
      {disabled && (
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
          AI 执行中，暂不可切换
        </span>
      )}
    </div>
  );
}