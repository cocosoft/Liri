interface AgentStrategy {
  id: string;
  name: string;
  description: string;
  icon: string;
}

interface AgentStrategySelectorProps {
  isDark: boolean;
  currentStrategy?: string;
  strategies: AgentStrategy[];
  onSelect: (strategyId: string) => void;
}

function AgentStrategySelector({
  isDark,
  currentStrategy,
  strategies,
  onSelect,
}: AgentStrategySelectorProps) {
  const displayStrategies = strategies;

  return (
    <div>
      <h2
        className={`text-lg font-medium mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
      >
        选择 Agent 策略
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {displayStrategies.map((strategy) => (
          <button
            key={strategy.id}
            onClick={() => onSelect(strategy.id)}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              currentStrategy === strategy.id
                ? isDark
                  ? "bg-blue-900/30 border-blue-500"
                  : "bg-blue-50 border-blue-500"
                : isDark
                  ? "bg-gray-800 border-gray-700 hover:border-gray-600"
                  : "bg-white border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{strategy.icon}</span>
              <div className="flex-1">
                <h3
                  className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                >
                  {strategy.name}
                </h3>
                <p
                  className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {strategy.description}
                </p>
              </div>
              {currentStrategy === strategy.id && (
                <svg
                  className="w-5 h-5 text-blue-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
          </button>
        ))}
      </div>

      <div
        className={`mt-6 p-4 rounded-lg ${isDark ? "bg-gray-800" : "bg-gray-50"}`}
      >
        <h3
          className={`text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          策略说明
        </h3>
        <ul
          className={`text-sm space-y-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          <li>
            • <strong>通用策略</strong>：适合大多数场景，自动调整处理方式
          </li>
          <li>
            • <strong>代码策略</strong>：针对编程任务优化，提供更准确的代码建议
          </li>
          <li>
            • <strong>探索策略</strong>：深入分析问题，适合研究和复杂决策
          </li>
          <li>
            • <strong>规划策略</strong>：分解复杂任务，逐步执行
          </li>
        </ul>
      </div>
    </div>
  );
}

export default AgentStrategySelector;
