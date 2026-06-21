/**
 * Agent Council Engine（Agent 理事会引擎）
 *
 * 负责管理多 Agent 辩论流程：
 * 1. 召集相关 Agent
 * 2. 多轮辩论（陈述→反驳→补充→总结）
 * 3. 共识判定
 * 4. 流式推送辩论过程
 *
 * 注意：CouncilEngine 不直接调用 AI，它只是一个流程编排器。
 * 实际的 AI 调用由调用方（如 OrchEngine 或 ChatManager）完成，
 * 通过回调将 AI 发言注入 CouncilEngine。
 */

import { randomUUID } from "node:crypto";
import type {
  CouncilSession,
  CouncilPhase,
  CouncilAgentRole,
  CouncilStatement,
  CouncilStreamEvent,
  ConsensusResult,
} from "./CouncilTypes.js";

/** Council 配置 */
export interface CouncilConfig {
  /** 最大辩论轮次（默认 3） */
  maxRounds?: number;
  /** 是否启用辩论 */
  enabled?: boolean;
}

/** 提交发言的回调 */
export type CouncilStatementCallback = (
  agentId: string,
  agentName: string,
  round: number,
  type: CouncilStatement["type"],
  topic: string,
  context: string,
  previousStatements: CouncilStatement[]
) => Promise<{ content: string; keyPoints: string[] }>;

/** 共识判定回调 */
export type CouncilConsensusCallback = (
  session: CouncilSession
) => Promise<{
  result: ConsensusResult;
  finalProposal: string;
  minorityOpinion: string | null;
}>;

/** 流式事件推送器 */
export type CouncilEventEmitter = (event: CouncilStreamEvent) => void;

/**
 * Agent Council 引擎
 */
export class CouncilEngine {
  private activeSessions: Map<string, CouncilSession> = new Map();
  private emit: CouncilEventEmitter;

  constructor(emit: CouncilEventEmitter) {
    this.emit = emit;
  }

  /**
   * 创建 Council 会话
   * @param workspaceId 工作空间 ID
   * @param topic 议题
   * @param context 背景描述
   * @param agents 参与 Agent 列表
   * @param config 配置
   */
  createSession(
    workspaceId: string,
    topic: string,
    context: string,
    agents: CouncilAgentRole[],
    config: CouncilConfig = {}
  ): CouncilSession {
    const sessionId = randomUUID();
    const maxRounds = config.maxRounds ?? 3;

    const session: CouncilSession = {
      sessionId,
      workspaceId,
      phase: "convening",
      topic,
      context,
      agents,
      currentRound: 0,
      maxRounds,
      statements: [],
      result: null,
      finalProposal: null,
      minorityOpinion: undefined,
      createdAt: Date.now(),
      completedAt: null,
    };

    this.activeSessions.set(sessionId, session);

    this.emit({
      type: "council_started",
      sessionId,
      phase: "convening",
      timestamp: Date.now(),
    });

    return session;
  }

  /**
   * 获取活动的 Council 会话
   */
  getSession(sessionId: string): CouncilSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * 执行完整辩论流程
   * @param sessionId 会话 ID
   * @param statementCallback 获取 Agent 发言的回调
   * @param consensusCallback 共识判定回调
   */
  async runDebate(
    sessionId: string,
    statementCallback: CouncilStatementCallback,
    consensusCallback: CouncilConsensusCallback
  ): Promise<CouncilSession> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Council session not found: ${sessionId}`);
    }

    try {
      // 阶段 1：召集 Agent（通知所有 Agent 加入）
      session.phase = "convening";
      for (const agent of session.agents) {
        this.emit({
          type: "agent_joined",
          sessionId,
          phase: session.phase,
          timestamp: Date.now(),
        });
      }

      // 阶段 2：多轮辩论
      session.phase = "debating";

      for (let round = 1; round <= session.maxRounds; round++) {
        session.currentRound = round;

        this.emit({
          type: "round_started",
          sessionId,
          phase: session.phase,
          round,
          timestamp: Date.now(),
        });

        // 确定本轮发言类型
        const statementType: CouncilStatement["type"] =
          round === 1
            ? "position" // 第一轮：立场陈述
            : round === session.maxRounds
              ? "final" // 最后一轮：总结
              : "rebuttal"; // 中间轮：反驳

        // 每个 Agent 依次发言
        for (const agent of session.agents) {
          const response = await statementCallback(
            agent.agentId,
            agent.name,
            round,
            statementType,
            session.topic,
            session.context,
            session.statements
          );

          const statement: CouncilStatement = {
            id: randomUUID(),
            agentId: agent.agentId,
            agentName: agent.name,
            round,
            type: statementType,
            content: response.content,
            keyPoints: response.keyPoints,
            timestamp: Date.now(),
          };

          session.statements.push(statement);

          this.emit({
            type: "statement",
            sessionId,
            phase: session.phase,
            round,
            statement,
            timestamp: Date.now(),
          });
        }

        this.emit({
          type: "round_completed",
          sessionId,
          phase: session.phase,
          round,
          timestamp: Date.now(),
        });
      }

      // 阶段 3：共识判定
      session.phase = "consensus";

      const consensus = await consensusCallback(session);
      session.result = consensus.result;
      session.finalProposal = consensus.finalProposal;
      session.minorityOpinion = consensus.minorityOpinion ?? undefined;

      this.emit({
        type: "consensus_reached",
        sessionId,
        phase: session.phase,
        result: consensus.result,
        finalProposal: consensus.finalProposal,
        minorityOpinion: consensus.minorityOpinion ?? undefined,
        timestamp: Date.now(),
      });

      // 阶段 4：完成
      session.phase = "completed";
      session.completedAt = Date.now();

      this.emit({
        type: "council_completed",
        sessionId,
        phase: session.phase,
        finalProposal: session.finalProposal,
        timestamp: Date.now(),
      });

      return session;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.emit({
        type: "council_error",
        sessionId,
        error: errorMsg,
        timestamp: Date.now(),
      });

      throw error;
    }
  }

  /**
   * 获取指定工作空间下所有活跃的 Council 会话
   */
  getActiveSessionsByWorkspace(workspaceId: string): CouncilSession[] {
    const sessions: CouncilSession[] = [];
    for (const session of this.activeSessions.values()) {
      if (session.workspaceId === workspaceId) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * 移除已完成的 Council 会话
   */
  removeSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }
}