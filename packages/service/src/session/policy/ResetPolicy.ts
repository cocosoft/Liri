export type ResetPolicyMode = 'none' | 'idle' | 'daily' | 'both';

export interface ResetPolicy {
  mode: ResetPolicyMode;
  idleMinutes?: number;
  dailyResetHour?: number;
  dailyResetMinute?: number;
  dailyResetTimezone?: string;
  preserveMetadata?: boolean;
}

export interface ResetAction {
  reason: 'idle' | 'daily' | 'none';
  action: 'skip' | 'mark_idle' | 'reset';
}

export const DEFAULT_RESET_POLICY: ResetPolicy = {
  mode: 'idle',
  idleMinutes: 30,
  dailyResetHour: 4,
  dailyResetMinute: 0,
  dailyResetTimezone: 'local',
  preserveMetadata: true,
};
