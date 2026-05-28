// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
