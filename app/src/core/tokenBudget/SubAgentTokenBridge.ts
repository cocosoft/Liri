/**
 * SubAgentTokenBridge — 子 Agent token 消耗汇聚桥接
 *
 * 当 AgentTool 执行子 Agent 完成后，通过此桥接将子 Agent 的
 * 真实 token 消耗上报到父会话的 UnifiedTokenTracker，
 * 使压缩决策和成本计算能计入子 Agent 的消耗。
 *
 * 使用全局回调数组模式（与 traceUsageListeners 一致），
 * 避免模块间循环依赖。
 */
export interface SubAgentTokenUsage {
  sessionId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type SubAgentTokenListener = (usage: SubAgentTokenUsage) => void;

/** 全局子 Agent token 消耗监听器列表 */
export const subAgentTokenListeners: SubAgentTokenListener[] = [];
