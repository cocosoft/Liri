import { useState, useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { workspaceService } from "../../services/workspaceService";
import AgentChatPanel from "../Agent/AgentChatPanel";

/**
 * Swarm Agent 数据类型
 */
interface SwarmAgent {
  id: string;
  name: string;
  role: string;
  status: "idle" | "running" | "completed" | "error";
  task?: string;
  progress?: number;
  connections: string[];
}

/** 状态对应的颜色 */
const STATUS_STYLE: Record<string, { dot: string; bg: string; text: string }> = {
  idle:      { dot: "bg-gray-400",  bg: "bg-gray-50 dark:bg-gray-800/50",    text: "text-gray-500 dark:text-gray-400" },
  running:   { dot: "bg-green-400", bg: "bg-green-50 dark:bg-green-900/20",   text: "text-green-600 dark:text-green-400" },
  completed: { dot: "bg-blue-400",  bg: "bg-blue-50 dark:bg-blue-900/20",    text: "text-blue-600 dark:text-blue-400" },
  error:     { dot: "bg-red-400",   bg: "bg-red-50 dark:bg-red-900/20",     text: "text-red-600 dark:text-red-400" },
};

const STATUS_LABEL: Record<string, string> = {
  idle:      "空闲",
  running:   "运行中",
  completed: "已完成",
  error:     "出错",
};

/**
 * Agent 卡片网格组件
 *
 * 在 Workspace 区域展示当前工作区的 Agent 列表，以卡片网格形式呈现。
 * 每个卡片显示 Agent 的状态、角色、当前任务和进度。
 */
export default function AgentCardGrid() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const [agents, setAgents] = useState<SwarmAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);

  const fetchAgents = async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await workspaceService.getSwarmStatus(activeWorkspaceId);
      if (data.agents && Array.isArray(data.agents)) {
        setAgents(data.agents as SwarmAgent[]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, [activeWorkspaceId]);

  return (
    <div className="h-full flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Agent 列表
        </h2>
        <button
          onClick={fetchAgents}
          disabled={loading}
          className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 空状态 */}
      {!loading && agents.length === 0 && !error && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {activeWorkspaceId ? "暂无 Agent 数据" : "请先选择工作区"}
          </p>
        </div>
      )}

      {/* Agent 卡片网格 */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={`rounded-lg border border-gray-200 dark:border-gray-700 p-3 transition-colors ${
                STATUS_STYLE[agent.status]?.bg ?? "bg-white dark:bg-gray-800"
              }`}
            >
              {/* 卡片头部 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    STATUS_STYLE[agent.status]?.dot ?? "bg-gray-400"
                  }`} />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                    {agent.name}
                  </span>
                </div>
                <span className={`text-[10px] font-medium flex-shrink-0 ${
                  STATUS_STYLE[agent.status]?.text ?? "text-gray-500"
                }`}>
                  {STATUS_LABEL[agent.status] ?? agent.status}
                </span>
              </div>

              {/* 角色 */}
              <div className="mb-2">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">角色</span>
                <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  {agent.role}
                </p>
              </div>

              {/* 任务和进度 */}
              {agent.task && (
                <div className="mb-2">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">当前任务</span>
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {agent.task}
                  </p>
                </div>
              )}

              {agent.progress !== undefined && agent.progress > 0 && (
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">进度</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      {Math.round(agent.progress * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-500"
                      style={{ width: `${agent.progress * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 连接数 */}
              {agent.connections && agent.connections.length > 0 && (
                <div className="text-[10px] text-gray-400 dark:text-gray-500">
                  连接 {agent.connections.length} 个 Agent
                </div>
              )}

              {/* 操作按钮 */}
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex gap-1">
                <button
                  onClick={() => setChatAgentId(chatAgentId === agent.id ? null : agent.id)}
                  className="text-[10px] px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                >
                  {chatAgentId === agent.id ? "收起对话" : "对话"}
                </button>
              </div>

              {/* 内联对话面板 */}
              {chatAgentId === agent.id && (
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <div className="h-48">
                    <AgentChatPanel taskId={agent.id} taskName={agent.name} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
