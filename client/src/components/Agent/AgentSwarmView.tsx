import { useTranslation } from "react-i18next";

interface SwarmAgent {
  id: string;
  name: string;
  role: string;
  status: "idle" | "running" | "completed" | "error";
  connections: string[];
}

interface AgentSwarmViewProps {
  isDark: boolean;
  agents: SwarmAgent[];
  onAgentClick: (agent: SwarmAgent) => void;
}

const STATUS_COLORS = {
  idle: { bg: "bg-gray-400", text: "text-gray-400", dot: "bg-gray-400" },
  running: { bg: "bg-green-400", text: "text-green-400", dot: "bg-green-400" },
  completed: { bg: "bg-blue-400", text: "text-blue-400", dot: "bg-blue-400" },
  error: { bg: "bg-red-400", text: "text-red-400", dot: "bg-red-400" },
};

function AgentSwarmView({ isDark, agents, onAgentClick }: AgentSwarmViewProps) {
  const { t } = useTranslation();
  const displayAgents = agents;

  const getAgentPosition = (index: number, total: number) => {
    const angle = (2 * Math.PI * index) / total - Math.PI / 2;
    const radius = 180;
    const centerX = 250;
    const centerY = 200;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2
          className={`text-lg font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          Swarm 编排视图
        </h2>
        <div
          className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          {displayAgents.length} 个 Agent
        </div>
      </div>

      <div
        className={`relative rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
      >
        <svg width="500" height="400" className="overflow-visible">
          {displayAgents.map((agent, index) => {
            const pos = getAgentPosition(index, displayAgents.length);
            return (
              <g key={agent.id}>
                {agent.connections.map((targetId) => {
                  const targetIndex = displayAgents.findIndex(
                    (a) => a.id === targetId,
                  );
                  if (targetIndex === -1) return null;
                  const targetPos = getAgentPosition(
                    targetIndex,
                    displayAgents.length,
                  );
                  return (
                    <line
                      key={`${agent.id}-${targetId}`}
                      x1={pos.x}
                      y1={pos.y}
                      x2={targetPos.x}
                      y2={targetPos.y}
                      className={`stroke-current ${isDark ? "stroke-gray-600" : "stroke-gray-300"}`}
                      strokeWidth="2"
                      strokeDasharray="4 4"
                    />
                  );
                })}
              </g>
            );
          })}

          {displayAgents.map((agent, index) => {
            const pos = getAgentPosition(index, displayAgents.length);
            const statusColor = STATUS_COLORS[agent.status];

            return (
              <g
                key={agent.id}
                onClick={() => onAgentClick(agent)}
                className="cursor-pointer"
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r="40"
                  className={`fill-current ${isDark ? "fill-gray-700" : "fill-white"}`}
                  stroke={statusColor.bg}
                  strokeWidth="3"
                />
                <text
                  x={pos.x}
                  y={pos.y - 10}
                  textAnchor="middle"
                  className={`text-sm font-medium fill-current ${isDark ? "fill-gray-200" : "fill-gray-800"}`}
                >
                  {agent.name}
                </text>
                <text
                  x={pos.x}
                  y={pos.y + 10}
                  textAnchor="middle"
                  className={`text-xs fill-current ${isDark ? "fill-gray-400" : "fill-gray-500"}`}
                >
                  {agent.role}
                </text>
                <circle
                  cx={pos.x + 30}
                  cy={pos.y - 30}
                  r="6"
                  className={`fill-current ${statusColor.dot}`}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div
        className={`mt-4 p-4 rounded-lg ${isDark ? "bg-gray-800" : "bg-gray-50"}`}
      >
        <h3
          className={`text-sm font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          {t("agent.legend")}
        </h3>
        <div className="flex flex-wrap gap-4">
          {Object.entries(STATUS_COLORS).map(([status, colors]) => (
            <div key={status} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${colors.dot}`} />
              <span className={`text-sm ${colors.text}`}>
                {status === "idle" && t("agent.idle")}
                {status === "running" && t("agent.running")}
                {status === "completed" && t("agent.completed")}
                {status === "error" && t("agent.error")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AgentSwarmView;
