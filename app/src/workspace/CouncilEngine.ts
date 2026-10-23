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

import { randomUUID } from 'crypto';
import type {
  CouncilSession,
  CouncilAgentRole,
  CouncilStatement,
  CouncilStreamEvent,
  ConsensusResult,
} from './CouncilTypes.js';
import { globalEventBus } from '@modules/core/events/EventBus.js';
import { OrchestrationEventType } from '@modules/agent';
import type {
  CouncilRoundStartData,
  CouncilAgentSpeakingData,
  CouncilAgentDeltaData,
} from '@modules/agent';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error/handleError';
import { AppError } from '@modules/error';
// G-02（2026-10-19）：轮次级 in-flight 熔断（复用 chat 的单一预算收口，不新增判定点）
import { assertEntryBudget } from '../query/dailyBudgetGate';
import type {
  ISnapshotCapable,
  SnapshotHandle,
  SnapshotFreezeScope,
} from '../utils/toolContract/Tool.js';

const logger = getLogger('CouncilEngine');

/**
 * G-02：预算越界错误必须**穿透**「逐 Agent try/catch」。
 *
 * 该 catch 的语义是"单个 Agent 发言失败就跳过"，但预算越界是**全会话**级的终止信号 ——
 * 若被降级成占位发言，后续 Agent/轮次仍会继续调用模型（费用继续逃逸）。
 */
function isDailyBudgetExceeded(err: unknown): boolean {
  return err instanceof AppError && err.code === 'DAILY_BUDGET_EXCEEDED';
}

/** Council 配置 */
export interface CouncilConfig {
  /** 最大辩论轮次（默认 3） */
  maxRounds?: number;
  /** 是否启用辩论 */
  enabled?: boolean;
  /** 聊天会话 ID（U-14 阶段 1.3：会话级挂起快照的关联键） */
  ownerSessionId?: string;
}

/** 提交发言的回调 */
export type CouncilStatementCallback = (
  agentId: string,
  agentName: string,
  round: number,
  type: CouncilStatement['type'],
  topic: string,
  context: string,
  previousStatements: CouncilStatement[]
) => Promise<{ content: string; keyPoints: string[] }>;

/** 共识判定回调 */
export type CouncilConsensusCallback = (session: CouncilSession) => Promise<{
  result: ConsensusResult;
  finalProposal: string;
  minorityOpinion: string | null;
}>;

/** 流式事件推送器 */
export type CouncilEventEmitter = (event: CouncilStreamEvent) => void;

/**
 * Agent Council 引擎
 */
export class CouncilEngine implements ISnapshotCapable {
  /** U-14：可挂起能力标记（字面量 true；探测见 `isSnapshotCapable()`） */
  readonly snapshotCapable = true as const;

  private activeSessions: Map<string, CouncilSession> = new Map();
  private emit: CouncilEventEmitter;

  constructor(emit: CouncilEventEmitter) {
    this.emit = emit;
  }

  /**
   * U-14：冻结 Council 会话（可序列化句柄）。
   *
   * 只做**内存态**快照，不改 `activeSessions` 结构与 Council 继承树；
   * 中心层（预算挂起/续跑）只做不透明搬运。
   *
   * **按会话过滤**（阶段 1.3）：传 `scope.sessionId` 时只冻结该会话 —— 挂起中心按会话挂起，
   * 全量快照在恢复时会覆盖其它仍在运行的会话。缺省保持旧的全量语义。
   */
  freezeForSuspend(scope?: SnapshotFreezeScope): SnapshotHandle {
    const sessionId = scope?.sessionId;
    const sessions = [...this.activeSessions.values()]
      // 关联键是**聊天会话**（`ownerSessionId`），不是辩论自身的 UUID
      .filter((s) => sessionId === undefined || s.ownerSessionId === sessionId)
      .map((s) => JSON.parse(JSON.stringify(s)) as CouncilSession);
    return {
      kind: 'council-engine',
      version: 2,
      mode: sessionId === undefined ? 'full' : 'session',
      ...(sessionId !== undefined ? { sessionId } : {}),
      capturedAt: Date.now(),
      sessions,
    };
  }

  /**
   * U-14：从快照恢复活跃会话（不触发 emit / 不写盘，保持只读投影语义）。
   *
   * `mode='full'`（缺省，兼容 v1 句柄）⇒ 整体覆盖；`mode='session'` ⇒ **只覆盖该会话**，
   * 其它会话原样保留（避免把无关会话回滚到旧状态）。
   */
  resumeFromSnapshot(handle: SnapshotHandle): void {
    if (handle.kind !== 'council-engine' || !Array.isArray(handle.sessions)) {
      throw new Error('invalid council snapshot handle');
    }
    const sessions = handle.sessions as CouncilSession[];
    const scoped = handle.mode === 'session';
    if (scoped) {
      const sessionId = handle.sessionId;
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('invalid council snapshot handle');
      }
      // 作用域恢复 = 该聊天会话的辩论集合**恰好**回到快照：先清掉快照之后新开的辩论
      const keep = new Set(
        sessions
          .filter((s) => s && s.ownerSessionId === sessionId)
          .map((s) => s.sessionId)
      );
      for (const [id, session] of this.activeSessions) {
        if (session.ownerSessionId === sessionId && !keep.has(id)) {
          this.activeSessions.delete(id);
        }
      }
    } else {
      this.activeSessions.clear();
    }
    for (const session of sessions) {
      if (!session || typeof session.sessionId !== 'string') continue;
      // 作用域快照只允许恢复被冻结的那个聊天会话（防御句柄内混入其它会话）
      if (scoped && session.ownerSessionId !== handle.sessionId) continue;
      this.activeSessions.set(
        session.sessionId,
        JSON.parse(JSON.stringify(session)) as CouncilSession
      );
    }
  }

  /**
   * 公开 setter，供 handler 初始化时绑定 SSE 连接池
   */
  public setEmitter(emit: CouncilEventEmitter): void {
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
      ...(config.ownerSessionId !== undefined
        ? { ownerSessionId: config.ownerSessionId }
        : {}),
      workspaceId,
      phase: 'convening',
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
      type: 'council_started',
      sessionId,
      phase: 'convening',
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
    const otel = getOTelTracing();
    const span = otel.startSpan('CouncilEngine.runDebate');
    span.setAttribute('sessionId', sessionId);
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Council session not found: ${sessionId}`);
      }

      // 阶段 1：召集 Agent（通知所有 Agent 加入）
      session.phase = 'convening';
      for (const agent of session.agents) {
        this.emit({
          type: 'agent_joined',
          agentId: agent.agentId,
          agentName: agent.name,
          sessionId,
          phase: session.phase,
          timestamp: Date.now(),
        });
      }

      // 阶段 2：多轮辩论
      session.phase = 'debating';

      for (let round = 1; round <= session.maxRounds; round++) {
        // G-02（2026-10-19）：每轮开始前复核预算（纯读；未配置 `limitUsd` ⇒ 恒放行）。
        // 依赖 G-01 的记账 —— 否则本轮之前 Council 的消耗根本不在账本里。
        assertEntryBudget({
          entry: session.ownerSessionId ?? sessionId,
          estimatedTokens: 0,
        });
        session.currentRound = round;

        this.emit({
          type: 'round_started',
          sessionId,
          phase: session.phase,
          round,
          timestamp: Date.now(),
        });

        // 发布辩论回合开始事件
        const roundStartData: CouncilRoundStartData = {
          round,
          totalRounds: session.maxRounds,
          sessionId,
        };
        globalEventBus.publish(
          OrchestrationEventType.COUNCIL_ROUND_START,
          roundStartData
        );

        // 确定本轮发言类型
        const statementType: CouncilStatement['type'] =
          round === 1
            ? 'position' // 第一轮：立场陈述
            : round === session.maxRounds
              ? 'final' // 最后一轮：总结
              : 'rebuttal'; // 中间轮：反驳

        // 每个 Agent 依次发言（逐 Agent try/catch，失败时跳过该 Agent 继续下一轮）
        for (const agent of session.agents) {
          // 发布 Agent 开始发言事件
          const speakingData: CouncilAgentSpeakingData = {
            agentId: agent.agentId,
            agentName: agent.name,
            agentRole: agent.agentId,
            round,
            sessionId,
          };
          globalEventBus.publish(
            OrchestrationEventType.COUNCIL_AGENT_SPEAKING,
            speakingData
          );

          try {
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
              type: 'statement',
              sessionId,
              phase: session.phase,
              round,
              statement,
              timestamp: Date.now(),
            });

            // 发布 Agent 发言完整内容事件
            const deltaData: CouncilAgentDeltaData = {
              agentId: agent.agentId,
              agentName: agent.name,
              agentRole: agent.agentId,
              content: response.content,
              round,
              isFinal: true,
              sessionId,
            };
            globalEventBus.publish(
              OrchestrationEventType.COUNCIL_AGENT_DELTA,
              deltaData
            );
          } catch (err) {
            // G-02：预算越界是全会话级终止信号，不得降级为"该 Agent 跳过"
            if (isDailyBudgetExceeded(err)) throw err;
            void handleError(err, {
              module: 'workspace:engine',
              action: 'agentStatement',
            });
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.warn(
              `Agent ${agent.name}（${agent.agentId}）在第 ${round} 轮发言失败，跳过`,
              {
                error: errorMsg,
              }
            );

            // 添加占位 statement，标记该 Agent 本轮未参与
            const placeholder: CouncilStatement = {
              id: randomUUID(),
              agentId: agent.agentId,
              agentName: agent.name,
              round,
              type: statementType,
              content: `[${agent.name} 本轮发言失败，已跳过]`,
              keyPoints: [],
              timestamp: Date.now(),
            };

            session.statements.push(placeholder);

            this.emit({
              type: 'statement',
              sessionId,
              phase: session.phase,
              round,
              statement: placeholder,
              timestamp: Date.now(),
            });

            // 发布 Agent 发言失败事件
            const errorDelta: CouncilAgentDeltaData = {
              agentId: agent.agentId,
              agentName: agent.name,
              agentRole: agent.agentId,
              content: `[${agent.name} 本轮发言失败，已跳过]`,
              round,
              isFinal: true,
              sessionId,
            };
            globalEventBus.publish(
              OrchestrationEventType.COUNCIL_AGENT_DELTA,
              errorDelta
            );

            // 继续下一个 Agent，不中断整个辩论
          }
        }

        this.emit({
          type: 'round_completed',
          sessionId,
          phase: session.phase,
          round,
          timestamp: Date.now(),
        });
      }

      // 阶段 3：共识判定
      session.phase = 'consensus';

      const consensus = await consensusCallback(session);
      session.result = consensus.result;
      session.finalProposal = consensus.finalProposal;
      session.minorityOpinion = consensus.minorityOpinion ?? undefined;

      this.emit({
        type: 'consensus_reached',
        sessionId,
        phase: session.phase,
        result: consensus.result,
        finalProposal: consensus.finalProposal,
        minorityOpinion: consensus.minorityOpinion ?? undefined,
        timestamp: Date.now(),
      });

      // 阶段 4：完成
      session.phase = 'completed';
      session.completedAt = Date.now();

      this.emit({
        type: 'council_completed',
        sessionId,
        phase: session.phase,
        finalProposal: session.finalProposal,
        timestamp: Date.now(),
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return session;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      void handleError(error, {
        module: 'workspace:engine',
        action: 'runDebate',
      });
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.emit({
        type: 'council_error',
        sessionId,
        error: errorMsg,
        timestamp: Date.now(),
      });

      throw error;
    } finally {
      span.end();
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

// ============================================================
// 全局单例
// ============================================================

let _defaultEngine: CouncilEngine | null = null;

/**
 * 获取 CouncilEngine 全局单例
 * emit 回调由 handler 初始化时通过 setCouncilEmitter() 重设
 */
export function getCouncilEngine(): CouncilEngine {
  if (!_defaultEngine) {
    _defaultEngine = new CouncilEngine(() => {});
  }
  return _defaultEngine;
}

/**
 * 设置 emit 回调（在 handler 初始化时调用，绑定 SSE 连接池）
 */
export function setCouncilEmitter(emit: CouncilEventEmitter): void {
  getCouncilEngine().setEmitter(emit);
}
