import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const displayStrategies = strategies;

  return (
    <div>
      <h2
        className={`text-lg font-medium mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
      >
        {t('selectAgentStrategy')}
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
            • <strong>{t("agent.config")}</strong>：{t("agent.capabilities")}
          </li>
          <li>
            • <strong>{t("agent.config")}</strong>：{t("agent.status")}
          </li>
          <li>
            • <strong>{t("agent.advanced")}</strong>：{t("agent.trajectory")}
          </li>
          <li>
            • <strong>{t("agent.advanced")}</strong>：{t("agent.capabilities")}
          </li>
        </ul>
      </div>
    </div>
  );
}

export default AgentStrategySelector;
