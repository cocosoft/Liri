/**
 * CouncilView — Agent 理事会视图
 *
 * 展示 Plan 模式下 AI 内部的多 Agent 辩论过程。
 * 用户主动要求查看时才显示：
 * - 左侧：参与 Agent 列表 + 专业领域
 * - 右侧：按轮次展示辩论发言
 * - 底部：共识结果 + 最终方案
 */
import React, { useEffect, useRef } from "react";
import { handleClientError } from "../../utils/handleError";
import { useCouncilStore } from "../../stores/councilStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type {
  CouncilStatementUI,
  CouncilPhaseUI,
} from "../../stores/councilStore";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:councilView");

/** 阶段标签映射 */
const PHASE_LABELS: Record<CouncilPhaseUI, string> = {
  idle: "等待中",
  convening: "召集专家中...",
  debating: "辩论中",
  consensus: "达成共识中...",
  completed: "已完成",
  error: "出错",
};

/** 发言类型标签 */
const STATEMENT_TYPE_LABELS: Record<string, string> = {
  position: "立场陈述",
  rebuttal: "反驳",
  supplement: "补充论证",
  final: "最终总结",
};

/** 发言类型颜色 */
const STATEMENT_TYPE_COLORS: Record<string, string> = {
  position: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  rebuttal:
    "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  supplement:
    "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  final:
    "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

/** 共识结果图标 */
const RESULT_ICONS: Record<string, string> = {
  unanimous: "\u2705", // 一致通过
  majority: "\u{1F4B0}", // 多数表决
  deadlock: "\u26A0\uFE0F", // 无法达成
};

/** 单条发言 */
const StatementBubble: React.FC<{ statement: CouncilStatementUI }> = ({
  statement,
}) => {
  return (
    <div className="mb-3 pl-2 border-l-2 border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {statement.agentName}
        </span>
        <span
          className={`text-xs px-1.5 py-0.5 rounded ${STATEMENT_TYPE_COLORS[statement.type] || "bg-gray-100 text-gray-600"}`}
        >
          {STATEMENT_TYPE_LABELS[statement.type] || statement.type}
        </span>
        <span className="text-xs text-gray-400">第 {statement.round} 轮</span>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
        {statement.content}
      </p>
      {statement.keyPoints.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {statement.keyPoints.map((point, i) => (
            <span
              key={i}
              className="text-xs px-1.5 py-0.5 rounded bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
            >
              {point}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/** 共识结果展示 */
const ConsensusResult: React.FC = () => {
  const result = useCouncilStore((s) => s.result);
  const finalProposal = useCouncilStore((s) => s.finalProposal);
  const minorityOpinion = useCouncilStore((s) => s.minorityOpinion);

  if (!result) return null;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{RESULT_ICONS[result] || "\u2753"}</span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {result === "unanimous"
            ? "一致通过"
            : result === "majority"
              ? "多数表决通过"
              : "无法达成共识"}
        </span>
      </div>
      {finalProposal && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-3 mb-2">
          <p className="text-xs text-green-600 dark:text-green-400 font-medium mb-1">
            最终方案
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {finalProposal}
          </p>
        </div>
      )}
      {minorityOpinion && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
          <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium mb-1">
            少数派意见
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {minorityOpinion}
          </p>
        </div>
      )}
    </div>
  );
};

/** 空状态 */
const EmptyState: React.FC = () => {
  const handleCreateManualCouncil = async () => {
    const topic = prompt("请输入需要讨论的议题：");
    if (!topic) return;

    try {
      const { workspaceService } =
        await import("../../services/workspaceService");
      const { httpLegacy } = await import("../../services/httpClient");

      const workspaceId =
        useWorkspaceStore.getState().currentWorkspace?.id || "default";

      // 从 API 加载启用的 Agent 角色，失败时使用硬编码默认值
      let agents: Array<{
        agentId: string;
        name: string;
        expertise: string[];
        weight: number;
      }>;
      try {
        const roles = await httpLegacy.get<any[]>("/v1/agent-roles");
        const enabledRoles = roles.filter((r) => r.enabled !== false);
        if (enabledRoles.length > 0) {
          agents = enabledRoles.map((r) => ({
            agentId: r.agentId,
            name: r.name,
            expertise: r.expertise || [],
            weight: r.weight ?? 1.0,
          }));
        } else {
          throw new Error("无可用角色");
        }
      } catch (e) {
        handleClientError(e, {
          module: "components:workspace:Council",
          action: "initializeAgents",
        });
        // 回退到硬编码默认值
        agents = [
          {
            agentId: "architect",
            name: "架构师",
            expertise: ["系统架构", "技术选型"],
            weight: 5,
          },
          {
            agentId: "security",
            name: "安全专家",
            expertise: ["安全审计", "漏洞分析"],
            weight: 5,
          },
          {
            agentId: "performance",
            name: "性能专家",
            expertise: ["性能优化", "并发处理"],
            weight: 4,
          },
          {
            agentId: "frontend",
            name: "前端专家",
            expertise: ["前端架构", "UI/UX"],
            weight: 4,
          },
          {
            agentId: "backend",
            name: "后端专家",
            expertise: ["后端开发", "API设计"],
            weight: 4,
          },
        ];
      }

      const result = await workspaceService.createCouncil(workspaceId, {
        topic,
        context: "",
        agents,
      });

      const sessionId = result.sessionId;
      useCouncilStore.getState().startCouncil(sessionId, topic);
    } catch (err) {
      logger.error("手动创建 Council 失败", err);
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-4xl mb-3">{"\u{1F3DB}\uFE0F"}</div>
        <h3 className="text-base font-medium text-gray-700 dark:text-gray-300">
          Agent 理事会
        </h3>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 max-w-sm">
          AI 在 UltraPlan 模式下遇到复杂决策时，会自动召集专家 Agent 进行辩论。
          你可以在这里查看辩论过程，或手动发起一次理事会讨论。
        </p>

        <button
          onClick={handleCreateManualCouncil}
          className="mt-4 px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
        >
          手动创建理事会讨论
        </button>
      </div>
    </div>
  );
};

/**
 * CouncilView 主组件
 */
export const CouncilView: React.FC = () => {
  const isActive = useCouncilStore((s) => s.isActive);
  const phase = useCouncilStore((s) => s.phase);
  const topic = useCouncilStore((s) => s.topic);
  const currentRound = useCouncilStore((s) => s.currentRound);
  const statements = useCouncilStore((s) => s.statements);
  const error = useCouncilStore((s) => s.error);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [statements]);

  // 组件卸载时清理 SSE 连接
  useEffect(() => {
    return () => {
      useCouncilStore.getState().reset();
    };
  }, []);

  if (!isActive) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部：议题 + 阶段 */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {topic || "辩论中..."}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              phase === "idle"
                ? "bg-gray-400"
                : phase === "completed"
                  ? "bg-green-500"
                  : phase === "debating"
                    ? "bg-blue-500 animate-pulse"
                    : phase === "error"
                      ? "bg-red-500"
                      : "bg-yellow-500 animate-pulse"
            }`}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {PHASE_LABELS[phase]}
          </span>
          {currentRound > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              | 第 {currentRound} 轮
            </span>
          )}
        </div>
      </div>

      {/* 发言列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {statements.length === 0 && phase !== "completed" && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin text-2xl mb-2">{"\u23F3"}</div>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                等待专家发言中...
              </p>
            </div>
          </div>
        )}

        {statements.map((stmt) => (
          <StatementBubble key={stmt.id} statement={stmt} />
        ))}

        <ConsensusResult />

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mt-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};
