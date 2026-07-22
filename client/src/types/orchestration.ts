/**
 * 编排时间线前端类型定义
 *
 * 与后端 OrchestrationEvents.ts 及 SSE 流事件格式对齐。
 */

// ========== 编排事件类型枚举 ==========

/** SSE 下发的编排事件类型（不含 orch: 前缀） */
export type TimelineEventType =
  // DAG 编排
  | "dag:start"
  | "dag:task:start"
  | "dag:task:progress"
  | "dag:task:end"
  | "dag:end"
  // Plan 编排
  | "plan:start"
  | "plan:step:start"
  | "plan:step:completed"
  | "plan:progress"
  | "plan:completed"
  // AgentChain 编排
  | "chain:start"
  | "chain:step"
  | "chain:end"
  // Council 辩论
  | "council:start"
  | "council:round:start"
  | "council:agent:speaking"
  | "council:agent:delta"
  | "council:round"
  | "council:end"
  | "council:detail"
  // Swarm 群组
  | "swarm:dispatch"
  | "swarm:agent:status"
  | "swarm:complete"
  // SubAgent 引擎
  | "agent:thinking:start"
  | "agent:thinking:delta"
  | "agent:thinking:end"
  | "agent:tool_call:start"
  | "agent:tool_call:delta"
  | "agent:tool_call:end";

// ========== 事件载荷接口 ==========

/** SSE 下发的原始事件结构 */
export interface SSETimelineEvent {
  event: string; // 原始事件类型（如 orch:council:start）
  data: unknown; // 事件载荷
  timestamp: number; // 时间戳
}

/** 前端统一时间线事件 */
export interface TimelineEvent {
  /** 全局唯一 ID（用于 dedup，历史回放时来自后端，实时时临时生成） */
  eventId: string;
  /** SSE 事件名 */
  type: TimelineEventType | string;
  /** 事件载荷 */
  data: unknown;
  /** 事件时间戳 */
  timestamp: number;
  /** 来源：实时 | 历史回放 */
  source: "live" | "history";
}

// ========== DAG 事件载荷 ==========

export interface DagTaskStartData {
  taskId: string;
  taskName: string;
  dependsOn: string[];
  input: string;
}

export interface DagTaskProgressData {
  taskId: string;
  progress: number;
  detail?: string;
}

export interface DagTaskEndData {
  taskId: string;
  success: boolean;
  content?: string;
  error?: string;
  durationMs: number;
}

export interface DagStartData {
  planId: string;
  tasks: Array<{ id: string; name: string; dependsOn: string[] }>;
}

export interface DagEndData {
  planId: string;
  success: boolean;
}

// ========== Plan 事件载荷 ==========

export interface PlanStepStartData {
  stepId: string;
  stepName: string;
}

export interface PlanStepCompletedData {
  stepId: string;
  result: string;
  durationMs: number;
}

export interface PlanProgressData {
  progress: number;
  currentStep: string;
}

// ========== Chain 事件载荷 ==========

export interface ChainStartData {
  chainId: string;
  agents: string[];
}

export interface ChainStepData {
  agentId: string;
  agentName: string;
  input: string;
  output: string;
  durationMs: number;
}

// ========== Council 事件载荷 ==========

export interface CouncilStartData {
  sessionId: string;
  topic: string;
  agents: Array<{ agentId: string; name: string; expertise: string[] }>;
  maxRounds: number;
}

export interface CouncilRoundStartData {
  sessionId: string;
  round: number;
}

export interface CouncilAgentSpeakingData {
  sessionId: string;
  agentId: string;
  agentName: string;
  round: number;
  statementType: string;
  content: string;
  keyPoints: string[];
}

export interface CouncilAgentDeltaData {
  sessionId: string;
  agentId: string;
  delta: string;
  round: number;
}

export interface CouncilRoundData {
  sessionId: string;
  round: number;
  statements: Array<{
    agentId: string;
    agentName: string;
    type: string;
    content: string;
    keyPoints: string[];
  }>;
}

export interface CouncilEndData {
  sessionId: string;
  result: string;
  finalProposal: string;
  minorityOpinion?: string;
}

export interface CouncilDetailData {
  sessionId: string;
  round: number;
  agentId: string;
  agentName: string;
  content: string;
}

// ========== Swarm 事件载荷 ==========

export interface SwarmDispatchData {
  taskId: string;
  agentIds: string[];
  description: string;
}

export interface SwarmAgentStatusData {
  agentId: string;
  agentName: string;
  status: "idle" | "running" | "completed" | "failed";
  progress?: number;
  result?: string;
  error?: string;
}

export interface SwarmCompleteData {
  taskId: string;
  results: Array<{
    agentId: string;
    result: string;
  }>;
}

// ========== SubAgent 事件载荷 ==========

export interface AgentThinkingStartData {
  agentId: string;
  agentName: string;
  input: string;
}

export interface AgentThinkingDeltaData {
  agentId: string;
  delta: string;
}

export interface AgentThinkingEndData {
  agentId: string;
  content: string;
  durationMs: number;
}

export interface AgentToolCallStartData {
  agentId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentToolCallDeltaData {
  agentId: string;
  delta: string;
}

export interface AgentToolCallEndData {
  agentId: string;
  result: string;
  durationMs: number;
}

// ========== 历史回放 ==========

/** 后端历史查询响应 */
export interface OrchestrationHistoryResponse {
  events: Array<{
    eventId: string;
    eventType: string;
    payload: unknown;
    timestamp: number;
  }>;
  hasMore: boolean;
  latestTimestamp: number;
}
