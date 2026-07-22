import { useState, useEffect } from "react";
import { useConfigStore } from "../../stores/configStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { workspaceService } from "../../services/workspaceService";
import AgentStrategySelector from "../Agent/AgentStrategySelector";
import AgentSwarmView from "../Agent/AgentSwarmView";
import AgentTrajectoryView from "../Agent/AgentTrajectoryView";
import AgentIdentityConfig from "../Agent/AgentIdentityConfig";
import AgentModelBindingConfig from "../Workspace/AgentModelBindingConfig";

type AgentTab = "strategy" | "swarm" | "trajectory" | "identity" | "bindings";

function AgentAdvancedPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";
  const activeWorkspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);

  const [activeTab, setActiveTab] = useState<AgentTab>("strategy");
  const [currentStrategy, setCurrentStrategy] = useState<string>("general");
  const [swarmAgents, setSwarmAgents] = useState<
    Array<{
      id: string;
      name: string;
      role: string;
      status: "idle" | "running" | "completed" | "error";
      connections: string[];
    }>
  >([]);
  const [identity, setIdentity] = useState({
    name: "Assistant",
    description: "An intelligent AI assistant",
    personality: "Helpful, concise, and friendly",
    fastMode: false,
    remoteAgents: [] as string[],
  });

  const tabs: { key: AgentTab; label: string }[] = [
    { key: "strategy", label: "策略选择" },
    { key: "swarm", label: "Swarm编排" },
    { key: "trajectory", label: "执行轨迹" },
    { key: "identity", label: "身份配置" },
    { key: "bindings", label: "模型绑定" },
  ];

  useEffect(() => {
    if (activeWorkspaceId) {
      workspaceService.getSwarmStatus(activeWorkspaceId).then((data) => {
        if (data.agents && Array.isArray(data.agents)) {
          setSwarmAgents(
            data.agents as Array<{
              id: string;
              name: string;
              role: string;
              status: "idle" | "running" | "completed" | "error";
              connections: string[];
            }>,
          );
        }
      });
    }
  }, [activeWorkspaceId]);

  return (
    <div
      className={`flex-1 overflow-hidden flex flex-col ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-7xl mx-auto w-full p-6">
        <div className="mb-6">
          <h1
            className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            Agent 高级管理
          </h1>
          <p
            className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            配置 Agent 策略、Swarm 编排、执行轨迹和身份参数
          </p>
        </div>

        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-500 text-blue-500"
                  : isDark
                    ? "border-transparent text-gray-400 hover:text-gray-300"
                    : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {activeTab === "strategy" && (
            <AgentStrategySelector
              isDark={isDark}
              currentStrategy={currentStrategy}
              strategies={[]}
              onSelect={setCurrentStrategy}
            />
          )}

          {activeTab === "swarm" && (
            <AgentSwarmView
              isDark={isDark}
              agents={swarmAgents}
              onAgentClick={(agent) => void agent}
            />
          )}

          {activeTab === "trajectory" && (
            <AgentTrajectoryView isDark={isDark} trajectories={[]} />
          )}

          {activeTab === "identity" && (
            <AgentIdentityConfig
              isDark={isDark}
              config={identity}
              onUpdate={(newIdentity) =>
                setIdentity({ ...identity, ...newIdentity })
              }
            />
          )}

          {activeTab === "bindings" && activeWorkspaceId && (
            <AgentModelBindingConfig
              workspaceId={activeWorkspaceId}
              isDark={isDark}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentAdvancedPage;
