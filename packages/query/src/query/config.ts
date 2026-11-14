/**
 * 查询配置（参考CC源码 cc_code/query/config.ts）
 * 定义查询引擎的默认配置和配置选项
 */

export interface QueryConfig {
  maxTokens: number;
  maxTurns: number;
  maxBudgetUsd: number;
  temperature: number;
  topP: number;
  topK: number;
  stopSequences: string[];
  enableTools: boolean;
  enableStreaming: boolean;
  retryConfig: RetryConfig;
  compactConfig: CompactConfig;
  tokenBudgetConfig: TokenBudgetConfig;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

export interface CompactConfig {
  enabled: boolean;
  autoCompactThreshold: number;
  maxTokensPerMessage: number;
  preserveRecentMessages: number;
}

export interface TokenBudgetConfig {
  maxTokens: number;
  warningThreshold: number;
  criticalThreshold: number;
  budgetRefreshIntervalMs: number;
}

export const DEFAULT_QUERY_CONFIG: QueryConfig = {
  maxTokens: 200_000,
  maxTurns: 10,
  maxBudgetUsd: 100,
  temperature: 1,
  topP: 0.9,
  topK: 40,
  stopSequences: [],
  enableTools: true,
  enableStreaming: true,
  retryConfig: {
    maxRetries: 3,
    initialDelayMs: 500,
    maxDelayMs: 60_000,
    jitterFactor: 0.1,
  },
  compactConfig: {
    enabled: true,
    autoCompactThreshold: 0.7,
    maxTokensPerMessage: 10_000,
    preserveRecentMessages: 3,
  },
  tokenBudgetConfig: {
    maxTokens: 200_000,
    warningThreshold: 0.7,
    criticalThreshold: 0.9,
    budgetRefreshIntervalMs: 3_600_000,
  },
};

export class QueryConfigManager {
  private config: QueryConfig;

  constructor(config: Partial<QueryConfig> = {}) {
    this.config = {
      ...DEFAULT_QUERY_CONFIG,
      ...config,
      retryConfig: {
        ...DEFAULT_QUERY_CONFIG.retryConfig,
        ...config.retryConfig,
      },
      compactConfig: {
        ...DEFAULT_QUERY_CONFIG.compactConfig,
        ...config.compactConfig,
      },
      tokenBudgetConfig: {
        ...DEFAULT_QUERY_CONFIG.tokenBudgetConfig,
        ...config.tokenBudgetConfig,
      },
    };
  }

  getConfig(): QueryConfig {
    return { ...this.config };
  }

  get<K extends keyof QueryConfig>(key: K): QueryConfig[K] {
    return this.config[key];
  }

  set<K extends keyof QueryConfig>(key: K, value: QueryConfig[K]): void {
    this.config[key] = value;
  }

  update(updates: Partial<QueryConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  reset(): void {
    this.config = { ...DEFAULT_QUERY_CONFIG };
  }
}

export function createQueryConfigManager(
  config?: Partial<QueryConfig>
): QueryConfigManager {
  return new QueryConfigManager(config);
}
