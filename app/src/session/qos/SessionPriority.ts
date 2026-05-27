export type SessionPriorityLevel = 'critical' | 'high' | 'normal' | 'low';

export type QoSLevel = 'guaranteed' | 'high' | 'best_effort' | 'background';

export interface SessionPriority {
  level: SessionPriorityLevel;
  qos: QoSLevel;
  weight: number;
}

export interface QoSResourceLimits {
  maxConcurrent: number;
  maxTokensPerMinute: number;
  maxRequestsPerMinute: number;
}

export const PRIORITY_ORDER: Record<SessionPriorityLevel, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const DEFAULT_PRIORITY: SessionPriority = {
  level: 'normal',
  qos: 'best_effort',
  weight: 1,
};

export const QOS_RESOURCE_LIMITS: Record<QoSLevel, QoSResourceLimits> = {
  guaranteed: {
    maxConcurrent: 8,
    maxTokensPerMinute: 200000,
    maxRequestsPerMinute: 60,
  },
  high: {
    maxConcurrent: 4,
    maxTokensPerMinute: 100000,
    maxRequestsPerMinute: 30,
  },
  best_effort: {
    maxConcurrent: 2,
    maxTokensPerMinute: 50000,
    maxRequestsPerMinute: 15,
  },
  background: {
    maxConcurrent: 1,
    maxTokensPerMinute: 10000,
    maxRequestsPerMinute: 5,
  },
};
