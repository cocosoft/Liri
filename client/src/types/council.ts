/**
 * Council 前端类型定义
 * 与后端 CouncilTypes.ts 对齐
 */

/** Council 流式事件类型 */
export type CouncilEventType =
  | "council_started"
  | "agent_joined"
  | "round_started"
  | "statement"
  | "round_completed"
  | "consensus_reached"
  | "council_completed"
  | "council_error";

/** Council 流式事件 */
export interface CouncilStreamEvent {
  type: CouncilEventType;
  sessionId: string;
  phase?: string;
  round?: number;
  statement?: {
    id: string;
    agentId: string;
    agentName: string;
    round: number;
    type: "position" | "rebuttal" | "supplement" | "final";
    content: string;
    keyPoints: string[];
    timestamp: number;
  };
  result?: string;
  finalProposal?: string;
  minorityOpinion?: string;
  error?: string;
  timestamp: number;
}

/** Agent 角色 */
export interface CouncilAgentRole {
  agentId: string;
  name: string;
  expertise: string[];
  weight: number;
}

/** Council 会话 */
export interface CouncilSession {
  sessionId: string;
  workspaceId: string;
  phase: string;
  topic: string;
  context: string;
  agents: CouncilAgentRole[];
  currentRound: number;
  maxRounds: number;
  statements: CouncilStreamEvent["statement"][];
  result: string | null;
  finalProposal: string | null;
  minorityOpinion: string | null;
  createdAt: number;
  completedAt: number | null;
}
