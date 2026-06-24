/**
 * CouncilPanel — Council 辩论多列视图
 *
 * 以多列布局展示多 Agent 辩论过程：
 * - 每列代表一个 Agent
 * - 按轮次排列发言
 * - 底部显示共识结果
 */

import { useMemo } from "react";
import type { CouncilStartData, CouncilEndData } from "../../types/orchestration";

// ========== 类型定义 ==========

/** 单条发言记录 */
interface StatementRecord {
  id: string;
  agentId: string;
  agentName: string;
  round: number;
  type: string;
  content: string;
  delta?: string;
  keyPoints: string[];
  timestamp: number;
}

/** Agent 信息 */
interface AgentInfo {
  agentId: string;
  name: string;
  expertise: string[];
}

/** CouncilPanel 属性 */
interface CouncilPanelProps {
  /** Council 启动信息 */
  startData?: CouncilStartData;
  /** 当前轮次 */
  currentRound: number;
  /** 最大轮次 */
  maxRounds: number;
  /** 所有发言记录 */
  statements: StatementRecord[];
  /** 当前正在发言的 Agent ID */
  speakingAgentId?: string;
  /** 当前流式内容（按 agentId 分组） */
  streamingDeltas?: Record<string, string>;
  /** 最终结果 */
  endData?: CouncilEndData;
  /** 深色模式 */
  isDark: boolean;
}

// ========== 发言类型配置 ==========

const STATEMENT_STYLES: Record<string, { label: string; color: string }> = {
  position: { label: "立场", color: "border-l-blue-500 bg-blue-50 dark:bg-blue-900/20" },
  rebuttal: { label: "反驳", color: "border-l-orange-500 bg-orange-50 dark:bg-orange-900/20" },
  supplement: { label: "补充", color: "border-l-green-500 bg-green-50 dark:bg-green-900/20" },
  final: { label: "总结", color: "border-l-purple-500 bg-purple-50 dark:bg-purple-900/20" },
};

const DEFAULT_STATEMENT_STYLE = { label: "发言", color: "border-l-gray-500 bg-gray-50 dark:bg-gray-800" };

// ========== 共识结果配置 ==========

const RESULT_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  unanimous: { label: "一致通过", icon: "✅", color: "text-green-600 bg-green-50 dark:bg-green-900/20" },
  majority: { label: "多数表决", icon: "💰", color: "text-blue-600 bg-blue-50 dark:bg-blue-900/20" },
  deadlock: { label: "无法达成", icon: "⚠️", color: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20" },
};

const DEFAULT_RESULT = { label: "已完成", icon: "📋", color: "text-gray-600 bg-gray-50 dark:bg-gray-800" };

/**
 * CouncilPanel 组件
 */
function CouncilPanel({
  startData,
  currentRound,
  maxRounds,
  statements,
  speakingAgentId,
  streamingDeltas,
  endData,
  isDark,
}: CouncilPanelProps) {
  // 按 Agent 分组
  const agents = useMemo(() => {
    if (!startData) return [];
    return startData.agents;
  }, [startData]);

  // 按 Agent + 轮次分组
  const groupedByAgent = useMemo(() => {
    const map = new Map<string, StatementRecord[]>();
    for (const s of statements) {
      const list = map.get(s.agentId) || [];
      list.push(s);
      map.set(s.agentId, list);
    }
    return map;
  }, [statements]);

  if (!startData) {
    return null;
  }

  return (
    <div className="rounded-lg border dark:border-gray-700 overflow-hidden">
      {/* 头部 */}
      <div className={`p-3 border-b ${isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-gray-50"}`}>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">Agent 理事会辩论</h4>
            <p className="text-xs text-gray-500 mt-0.5">议题：{startData.topic}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              轮次 {currentRound}/{maxRounds}
            </span>
            <div className="flex items-center gap-1">
              {agents.map((a) => (
                <span
                  key={a.agentId}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    speakingAgentId === a.agentId
                      ? "bg-blue-500 text-white ring-2 ring-blue-300 animate-pulse"
                      : isDark
                        ? "bg-gray-700 text-gray-300"
                        : "bg-gray-200 text-gray-600"
                  }`}
                  title={a.name}
                >
                  {a.name.charAt(0)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 多列布局 */}
      <div className={`p-3 ${isDark ? "bg-gray-900" : "bg-white"}`}>
        <div className="flex gap-3 overflow-x-auto" style={{ minHeight: "120px" }}>
          {agents.map((agent) => {
            const agentStatements = groupedByAgent.get(agent.agentId) || [];
            const isSpeaking = speakingAgentId === agent.agentId;
            const delta = streamingDeltas?.[agent.agentId];

            return (
              <div
                key={agent.agentId}
                className={`flex-1 min-w-[200px] max-w-[300px] rounded-lg border ${
                  isSpeaking
                    ? "border-blue-400 ring-1 ring-blue-300"
                    : isDark
                      ? "border-gray-700"
                      : "border-gray-200"
                } ${isDark ? "bg-gray-800" : "bg-gray-50"}`}
              >
                {/* Agent 列头 */}
                <div className={`p-2 border-b text-center ${
                  isDark ? "border-gray-700" : "border-gray-200"
                }`}>
                  <div className="text-sm font-medium">{agent.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {agent.expertise.join("、")}
                  </div>
                </div>

                {/* 发言列表 */}
                <div className="p-2 space-y-2 max-h-[400px] overflow-y-auto">
                  {agentStatements.map((s) => {
                    const style = STATEMENT_STYLES[s.type] || DEFAULT_STATEMENT_STYLE;
                    return (
                      <div
                        key={s.id}
                        className={`text-xs p-2 rounded border-l-2 ${style.color} ${
                          isDark ? "border-gray-700" : "border-gray-200"
                        }`}
                      >
                        <div className="flex items-center gap-1 mb-1">
                          <span className="font-medium text-gray-500">
                            {style.label}
                          </span>
                          <span className="text-gray-400">第{s.round}轮</span>
                        </div>
                        <p className="whitespace-pre-wrap">{s.content}</p>
                        {s.keyPoints.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {s.keyPoints.map((kp, i) => (
                              <span
                                key={i}
                                className="text-xs px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500"
                              >
                                {kp}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* 流式内容 */}
                  {isSpeaking && delta && (
                    <div className="text-xs p-2 rounded border-l-2 border-blue-500 bg-blue-50 dark:bg-blue-900/20">
                      <span className="text-blue-500">发言中...</span>
                      <p className="whitespace-pre-wrap mt-1">{delta}</p>
                      <span className="inline-block w-1 h-3 bg-blue-500 ml-0.5 animate-pulse" />
                    </div>
                  )}

                  {!isSpeaking && agentStatements.length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-4">
                      等待发言...
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 共识结果 */}
      {endData && (
        <div className={`p-3 border-t ${isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-gray-50"}`}>
          <div className="flex items-start gap-3">
            <div className={`px-3 py-2 rounded-lg text-sm ${
              (RESULT_CONFIG[endData.result] || DEFAULT_RESULT).color
            }`}>
              <span className="mr-1">{(RESULT_CONFIG[endData.result] || DEFAULT_RESULT).icon}</span>
              {(RESULT_CONFIG[endData.result] || DEFAULT_RESULT).label}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium mb-1">最终方案</div>
              <p className="text-sm whitespace-pre-wrap">{endData.finalProposal}</p>
              {endData.minorityOpinion && (
                <div className="mt-2 text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
                  少数派意见：{endData.minorityOpinion}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CouncilPanel;
export type { StatementRecord, AgentInfo, CouncilPanelProps };
