/**
 * Agent 遥测
 * 每轮记录 turnCount/tokens/toolCalls/duration
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { getOTelMetrics } from '../monitoring/otel/OTelMetrics.js';

const logger = new Logger({ module: 'agent:telemetry', level: LogLevel.INFO });

export interface TurnMetrics {
  turnNumber: number;
  sessionId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
  toolNames: string[];
  modelName: string;
  status: 'running' | 'completed' | 'error' | 'aborted';
  errorMessage?: string;
}

export interface SessionMetrics {
  sessionId: string;
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalToolCalls: number;
  totalDurationMs: number;
  avgTurnDurationMs: number;
  startTime: number;
  lastActivityTime: number;
}

export class AgentTelemetry {
  private turns: Map<string, TurnMetrics[]> = new Map();
  private maxTurnsPerSession = 1000;

  startTurn(sessionId: string, modelName: string, turnNumber: number): void {
    const metrics: TurnMetrics = {
      turnNumber,
      sessionId,
      startTime: Date.now(),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: 0,
      toolNames: [],
      modelName,
      status: 'running',
    };

    const session = this.turns.get(sessionId) || [];
    session.push(metrics);
    if (session.length > this.maxTurnsPerSession) {
      session.shift();
    }
    this.turns.set(sessionId, session);
  }

  recordTokens(
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens = 0,
    cacheWriteTokens = 0
  ): void {
    const session = this.turns.get(sessionId);
    if (!session || session.length === 0) return;
    const current = session[session.length - 1];
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.cacheReadTokens += cacheReadTokens;
    current.cacheWriteTokens += cacheWriteTokens;
  }

  recordToolCall(sessionId: string, toolName: string): void {
    const session = this.turns.get(sessionId);
    if (!session || session.length === 0) return;
    const current = session[session.length - 1];
    current.toolCalls++;
    current.toolNames.push(toolName);
  }

  endTurn(
    sessionId: string,
    status: TurnMetrics['status'] = 'completed',
    errorMessage?: string
  ): void {
    const session = this.turns.get(sessionId);
    if (!session || session.length === 0) return;
    const current = session[session.length - 1];
    current.endTime = Date.now();
    current.durationMs = current.endTime - current.startTime;
    current.status = status;
    if (errorMessage) current.errorMessage = errorMessage;

    logger.debug(
      `Turn #${current.turnNumber}: ${current.inputTokens} in / ${current.outputTokens} out, ${current.toolCalls} tools, ${current.durationMs}ms`
    );

    // 推送 OTel 指标（方案 9：AgentTelemetry → OTel Metrics）
    try {
      const otel = getOTelMetrics();
      const attrs: Record<string, string | number | boolean> = {
        modelName: current.modelName,
        status: current.status,
        sessionId: current.sessionId,
      };

      otel.recordHistogram('agent.turn.duration', current.durationMs, attrs);
      otel.recordHistogram('agent.turn.input_tokens', current.inputTokens, {
        modelName: current.modelName,
      });
      otel.recordHistogram('agent.turn.output_tokens', current.outputTokens, {
        modelName: current.modelName,
      });

      if (current.toolCalls > 0) {
        otel.incrementCounter('agent.turn.tool_calls', current.toolCalls, {
          modelName: current.modelName,
        });
      }
    } catch {
      // OTel 不可用时不中断主流程
    }
  }

  getSessionMetrics(sessionId: string): SessionMetrics | null {
    const turns = this.turns.get(sessionId);
    if (!turns || turns.length === 0) return null;

    const completed = turns.filter((t) => t.endTime);
    return {
      sessionId,
      totalTurns: turns.length,
      totalInputTokens: turns.reduce((s, t) => s + t.inputTokens, 0),
      totalOutputTokens: turns.reduce((s, t) => s + t.outputTokens, 0),
      totalCacheReadTokens: turns.reduce((s, t) => s + t.cacheReadTokens, 0),
      totalCacheWriteTokens: turns.reduce((s, t) => s + t.cacheWriteTokens, 0),
      totalToolCalls: turns.reduce((s, t) => s + t.toolCalls, 0),
      totalDurationMs: completed.reduce((s, t) => s + (t.durationMs || 0), 0),
      avgTurnDurationMs:
        completed.length > 0
          ? Math.round(
              completed.reduce((s, t) => s + (t.durationMs || 0), 0) /
                completed.length
            )
          : 0,
      startTime: turns[0].startTime,
      lastActivityTime:
        turns[turns.length - 1].endTime || turns[turns.length - 1].startTime,
    };
  }

  getLastTurn(sessionId: string): TurnMetrics | null {
    const session = this.turns.get(sessionId);
    if (!session || session.length === 0) return null;
    return session[session.length - 1];
  }

  clearSession(sessionId: string): void {
    this.turns.delete(sessionId);
  }

  getAllActiveSessions(): string[] {
    return Array.from(this.turns.keys());
  }
}

export const agentTelemetry = new AgentTelemetry();
