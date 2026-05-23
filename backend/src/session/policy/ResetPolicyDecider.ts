import type { ResetPolicy, ResetAction } from './ResetPolicy';

export interface ResetEvaluableSession {
  id: string;
  lastActivityAt: number;
  createdAt: number;
  status: string;
}

export class ResetPolicyDecider {
  evaluate(session: ResetEvaluableSession, policy: ResetPolicy): ResetAction {
    if (policy.mode === 'none') {
      return { reason: 'none', action: 'skip' };
    }

    if (policy.mode === 'idle' || policy.mode === 'both') {
      const idleMs = (policy.idleMinutes ?? 30) * 60 * 1000;
      const now = Date.now();
      const idleTime = now - session.lastActivityAt;

      if (idleTime >= idleMs) {
        return { reason: 'idle', action: 'mark_idle' };
      }
    }

    if (policy.mode === 'daily' || policy.mode === 'both') {
      if (this.isDailyResetDue(session, policy)) {
        return { reason: 'daily', action: 'reset' };
      }
    }

    return { reason: 'none', action: 'skip' };
  }

  private isDailyResetDue(
    session: ResetEvaluableSession,
    policy: ResetPolicy
  ): boolean {
    const hour = policy.dailyResetHour ?? 4;
    const minute = policy.dailyResetMinute ?? 0;

    const now = new Date();
    const todayReset = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hour,
      minute,
      0,
      0
    );

    if (now.getTime() < todayReset.getTime()) {
      return false;
    }

    return session.createdAt < todayReset.getTime();
  }
}
