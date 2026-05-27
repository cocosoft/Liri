export enum LimitType {
  DAILY_MESSAGES = 'daily_messages',
  DAILY_TOKENS = 'daily_tokens',
  DAILY_TOOLS = 'daily_tools',
  HOURLY_TOKENS = 'hourly_tokens',
  MAX_CONCURRENT_SESSIONS = 'max_concurrent_sessions',
  MODEL_RESTRICTIONS = 'model_restrictions',
  TOOL_BLACKLIST = 'tool_blacklist',
  MAX_FILE_SIZE = 'max_file_size',
  RATE_LIMIT = 'rate_limit',
}

export interface PolicyDefinition {
  type: LimitType;
  value: number | string[] | Record<string, unknown>;
  scope: 'user' | 'organization' | 'session';
  message?: string;
}

export interface PolicyLimitConfig {
  apiUrl: string;
  apiKey?: string;
  pollInterval: number;
  timeout: number;
  enabled: boolean;
  defaultLimits: Map<LimitType, PolicyDefinition>;
}

export interface UsageQuota {
  type: LimitType;
  current: number;
  limit: number;
  resetAt: number;
  unit: 'count' | 'tokens' | 'bytes' | 'sessions';
}

export interface LimitCheckResult {
  allowed: boolean;
  type: LimitType;
  current: number;
  limit: number;
  remaining: number;
  message?: string;
  blockedBy?: PolicyDefinition;
}

export const DEFAULT_POLICY_CONFIG: PolicyLimitConfig = {
  apiUrl: process.env.POLICY_LIMITS_API_URL || '',
  apiKey: process.env.POLICY_LIMITS_API_KEY,
  pollInterval: parseInt(
    process.env.POLICY_LIMITS_POLL_INTERVAL || '60000',
    10
  ),
  timeout: 5000,
  enabled: process.env.POLICY_LIMITS_ENABLED === 'true',
  defaultLimits: new Map([
    [
      LimitType.DAILY_TOKENS,
      { type: LimitType.DAILY_TOKENS, value: 1_000_000, scope: 'user' },
    ],
    [
      LimitType.DAILY_MESSAGES,
      { type: LimitType.DAILY_MESSAGES, value: 500, scope: 'user' },
    ],
    [
      LimitType.DAILY_TOOLS,
      { type: LimitType.DAILY_TOOLS, value: 200, scope: 'user' },
    ],
    [
      LimitType.MAX_CONCURRENT_SESSIONS,
      { type: LimitType.MAX_CONCURRENT_SESSIONS, value: 3, scope: 'user' },
    ],
    [
      LimitType.MAX_FILE_SIZE,
      {
        type: LimitType.MAX_FILE_SIZE,
        value: 10 * 1024 * 1024,
        scope: 'session',
      },
    ],
  ]),
};
