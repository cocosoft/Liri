import type {
  SessionPriority,
  SessionPriorityLevel,
  QoSLevel,
  QoSResourceLimits,
} from './SessionPriority';
import { QOS_RESOURCE_LIMITS, DEFAULT_PRIORITY } from './SessionPriority';

export interface QoSSessionState {
  sessionId: string;
  priority: SessionPriority;
  activeRequests: number;
  tokensUsedThisMinute: number;
  requestsThisMinute: number;
  minuteStart: number;
}

export class QoSEnforcer {
  private sessionStates = new Map<string, QoSSessionState>();
  private activeCritical = 0;
  private activeHigh = 0;
  private activeNormal = 0;
  private activeLow = 0;

  private getLimit(qos: QoSLevel): QoSResourceLimits {
    return QOS_RESOURCE_LIMITS[qos];
  }

  registerSession(
    sessionId: string,
    priority: SessionPriority = { ...DEFAULT_PRIORITY }
  ): void {
    if (!this.sessionStates.has(sessionId)) {
      this.sessionStates.set(sessionId, {
        sessionId,
        priority,
        activeRequests: 0,
        tokensUsedThisMinute: 0,
        requestsThisMinute: 0,
        minuteStart: Date.now(),
      });
    }
  }

  updatePriority(sessionId: string, priority: SessionPriority): void {
    const state = this.sessionStates.get(sessionId);
    if (state) {
      state.priority = priority;
    }
  }

  unregisterSession(sessionId: string): void {
    const state = this.sessionStates.get(sessionId);
    if (state) {
      this.decrementActive(state.priority.level);
      this.sessionStates.delete(sessionId);
    }
  }

  canAcceptRequest(sessionId: string, estimatedTokens: number = 0): boolean {
    const state = this.sessionStates.get(sessionId);
    if (!state) return true;

    return this.canAccept(state, estimatedTokens);
  }

  beginRequest(sessionId: string, estimatedTokens: number = 0): boolean {
    const state = this.sessionStates.get(sessionId);
    if (!state) return false;

    // B4 修复：检查与递增在同一同步块内完成（事件循环内原子），
    // 消除"先 canAcceptRequest 再 beginRequest"之间被其他请求插队的 TOCTOU 窗口；
    // 同时补上 beginRequest 原本缺失的 token 额度检查（与 canAcceptRequest 一致）
    if (!this.canAccept(state, estimatedTokens)) return false;

    state.activeRequests++;
    state.requestsThisMinute++;
    this.incrementActive(state.priority.level);
    return true;
  }

  endRequest(sessionId: string, tokensUsed: number = 0): void {
    const state = this.sessionStates.get(sessionId);
    if (state) {
      state.activeRequests = Math.max(0, state.activeRequests - 1);
      state.tokensUsedThisMinute += tokensUsed;
      this.decrementActive(state.priority.level);
    }
  }

  getSessionStates(): Map<string, QoSSessionState> {
    return new Map(this.sessionStates);
  }

  getActiveCountByPriority(): Record<SessionPriorityLevel, number> {
    return {
      critical: this.activeCritical,
      high: this.activeHigh,
      normal: this.activeNormal,
      low: this.activeLow,
    };
  }

  getGlobalActiveCount(): number {
    return (
      this.activeCritical + this.activeHigh + this.activeNormal + this.activeLow
    );
  }

  clear(): void {
    this.sessionStates.clear();
    this.activeCritical = 0;
    this.activeHigh = 0;
    this.activeNormal = 0;
    this.activeLow = 0;
  }

  private canAccept(state: QoSSessionState, estimatedTokens: number): boolean {
    const limit = this.getLimit(state.priority.qos);
    this.resetMinuteIfNeeded(state);

    if (state.activeRequests >= limit.maxConcurrent) return false;
    if (state.requestsThisMinute >= limit.maxRequestsPerMinute) return false;
    if (
      estimatedTokens > 0 &&
      state.tokensUsedThisMinute + estimatedTokens > limit.maxTokensPerMinute
    )
      return false;

    return true;
  }

  private resetMinuteIfNeeded(state: QoSSessionState): void {
    const now = Date.now();
    if (now - state.minuteStart >= 60_000) {
      state.tokensUsedThisMinute = 0;
      state.requestsThisMinute = 0;
      state.minuteStart = now;
    }
  }

  private incrementActive(level: SessionPriorityLevel): void {
    if (level === 'critical') this.activeCritical++;
    else if (level === 'high') this.activeHigh++;
    else if (level === 'normal') this.activeNormal++;
    else this.activeLow++;
  }

  private decrementActive(level: SessionPriorityLevel): void {
    if (level === 'critical')
      this.activeCritical = Math.max(0, this.activeCritical - 1);
    else if (level === 'high')
      this.activeHigh = Math.max(0, this.activeHigh - 1);
    else if (level === 'normal')
      this.activeNormal = Math.max(0, this.activeNormal - 1);
    else this.activeLow = Math.max(0, this.activeLow - 1);
  }
}
