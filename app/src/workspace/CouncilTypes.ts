/**
 * Agent Council（Agent 理事会）类型定义
 *
 * Council 是 Plan 模式下的讨论式多 Agent 协作机制：
 * - AI 在遇到复杂决策时自动召集相关 Agent 进行辩论
 * - 用户看到的是综合回复，不感知背后的多 Agent 辩论
 * - 用户可主动要求查看讨论过程
 *
 * 与 Swarm 的区别：
 * - Swarm 是"分配式"（任务分解→分配→汇总）
 * - Council 是"讨论式"（多 Agent 同时辩论→达成共识）
 */

/** Council 辩论阶段 */
export type CouncilPhase = 'convening' | 'debating' | 'consensus' | 'completed';

/** 共识判定结果 */
export type ConsensusResult = 'unanimous' | 'majority' | 'deadlock';

/** Agent 角色 */
export interface CouncilAgentRole {
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** 专业领域（如：架构、性能、安全、前端、后端） */
  expertise: string[];
  /** 在 Council 中的发言权重（0-1，默认 1） */
  weight: number;
  /** 自定义 system prompt（可选，为空时使用内置默认 prompt） */
  systemPrompt?: string;
}

/** 单轮辩论中的一条发言 */
export interface CouncilStatement {
  /** 发言 ID */
  id: string;
  /** 发言人 Agent ID */
  agentId: string;
  /** 发言人名称 */
  agentName: string;
  /** 轮次编号（从 1 开始） */
  round: number;
  /** 发言类型 */
  type: 'position' | 'rebuttal' | 'supplement' | 'final';
  /** 发言内容 */
  content: string;
  /** 论据关键词 */
  keyPoints: string[];
  /** 时间戳 */
  timestamp: number;
}

/** Council 辩论状态 */
export interface CouncilSession {
  /** 会话 ID */
  sessionId: string;
  /** 所属工作空间 ID */
  workspaceId: string;
  /** 当前阶段 */
  phase: CouncilPhase;
  /** 议题 */
  topic: string;
  /** 背景描述 */
  context: string;
  /** 参与 Agent 列表 */
  agents: CouncilAgentRole[];
  /** 辩论轮次 */
  currentRound: number;
  /** 最大轮次（防止无限辩论） */
  maxRounds: number;
  /** 所有发言记录 */
  statements: CouncilStatement[];
  /** 共识结果 */
  result: ConsensusResult | null;
  /** 最终方案 */
  finalProposal: string | null;
  /** 少数派意见（majority 时有值） */
  minorityOpinion?: string;
  /** 创建时间 */
  createdAt: number;
  /** 完成时间 */
  completedAt: number | null;
}

/** Council 流式事件类型 */
export type CouncilEventType =
  | 'council_started'
  | 'agent_joined'
  | 'round_started'
  | 'statement'
  | 'round_completed'
  | 'consensus_reached'
  | 'council_completed'
  | 'council_error';

/** Council 流式事件 */
export interface CouncilStreamEvent {
  type: CouncilEventType;
  sessionId: string;
  /** 当前阶段 */
  phase?: CouncilPhase;
  /** 当前轮次 */
  round?: number;
  /** Agent ID（agent_joined 事件时有值） */
  agentId?: string;
  /** Agent 名称（agent_joined 事件时有值） */
  agentName?: string;
  /** 发言（statement 事件时有值） */
  statement?: CouncilStatement;
  /** 共识结果 */
  result?: ConsensusResult;
  /** 最终方案 */
  finalProposal?: string;
  /** 少数派意见 */
  minorityOpinion?: string;
  /** 错误信息 */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}
