import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { useRootStore } from "../../stores/root-store";
import { selectCurrentWorkspace } from "../../stores/selectors";
import { workspaceService } from "../../services/workspaceService";
import { configService } from "../../services/configService";
import AgentStrategySelector from "../Agent/AgentStrategySelector";
import AgentSwarmView from "../Agent/AgentSwarmView";
import AgentIdentityConfig from "../Agent/AgentIdentityConfig";
import AgentModelBindingConfig from "../Workspace/AgentModelBindingConfig";
import { createLogger } from "../../utils/logger";

const logger = createLogger("components:agent:advanced");

type AgentTab = "strategy" | "swarm" | "identity" | "bindings";

function AgentAdvancedPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";
  // BUG-02（2026-10-22 前端巡检）：只有**真实**工作空间（项目）才有后端 workspace 记录。
  // 系统工作空间（chat/media/office/calendar/translation/knowledge，见 workspaceSlice
  // 的 SYSTEM_WORKSPACES）也带 id，直接拿去查 /v1/workspaces/<id>/swarm 会 404
  //（如停留在知识库页后进入本页 ⇒ GET /v1/workspaces/knowledge/swarm ⇒ Workspace not found）。
  const currentWorkspace = useRootStore(selectCurrentWorkspace);
  const activeWorkspaceId =
    currentWorkspace && currentWorkspace.workspaceSource !== "system"
      ? currentWorkspace.id
      : undefined;

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
  // 身份配置：加载时从后端配置读取，更新时持久化（刷新后保留）
  const [identity, setIdentity] = useState({
    name: "Assistant",
    description: "An intelligent AI assistant",
    personality: "Helpful, concise, and friendly",
    fastMode: false,
    remoteAgents: [] as string[],
  });

  useEffect(() => {
    configService
      .get("agent.identity")
      .then((v) => {
        if (v && typeof v === "object") {
          setIdentity((prev) => ({ ...prev, ...(v as Partial<typeof prev>) }));
        }
      })
      .catch(() => {
        // @ignore-catch: 读取失败保持默认占位
      });
  }, []);

  const handleIdentityUpdate = (newIdentity: Partial<typeof identity>) => {
    const next = { ...identity, ...newIdentity };
    setIdentity(next);
    configService.set("agent.identity", next).catch(() => {
      // @ignore-catch: 网络失败由 configService 内存回退兜底
    });
  };

  const tabs: { key: AgentTab; labelKey: string }[] = [
    { key: "strategy", labelKey: "agent.strategySelector" },
    { key: "swarm", labelKey: "agent.swarmOrchestration" },
    { key: "identity", labelKey: "agent.identityConfig" },
    { key: "bindings", labelKey: "workspace.modelBinding" },
  ];

  useEffect(() => {
    if (activeWorkspaceId) {
      workspaceService
        .getSwarmStatus(activeWorkspaceId)
        .then((data) => {
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
        })
        .catch((error) => {
          // 工作空间可能已被删除（后端 404）⇒ 空态 + 可排查日志，不再静默吞错
          logger.warn("Swarm 状态加载失败", {
            workspaceId: activeWorkspaceId,
            error: String(error),
          });
          setSwarmAgents([]);
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
            {t("agent.advancedTitle")}
          </h1>
          <p
            className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {t("agent.advancedDesc")}
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
              {t(tab.labelKey)}
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
            <>
              {!activeWorkspaceId && (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("agent.needProjectWorkspace")}
                </div>
              )}
              <AgentSwarmView
                isDark={isDark}
                agents={swarmAgents}
                onAgentClick={(agent) => void agent}
              />
            </>
          )}

          {activeTab === "identity" && (
            <AgentIdentityConfig
              isDark={isDark}
              config={identity}
              onUpdate={handleIdentityUpdate}
            />
          )}

          {activeTab === "bindings" &&
            (activeWorkspaceId ? (
              <AgentModelBindingConfig
                workspaceId={activeWorkspaceId}
                isDark={isDark}
              />
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {t("agent.needProjectWorkspace")}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

export default AgentAdvancedPage;
