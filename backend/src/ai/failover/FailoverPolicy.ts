/**
 * 模型回退策略
 * 定义 Provider 回退链和回退触发条件
 * 对齐 OpenClaw agents/failover-policy.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export type FailoverReason =
  | 'rate_limited'
  | 'server_overloaded'
  | 'model_unavailable'
  | 'context_overflow'
  | 'timeout'
  | 'network_error'
  | 'auth_error'
  | 'unknown';

export interface FailoverEvent {
  reason: FailoverReason;
  fromProvider: string;
  toProvider: string;
  fromModel: string;
  toModel: string;
  timestamp: number;
  errorMessage?: string;
}

export interface FailoverChain {
  primary: { provider: string; model: string };
  fallbacks: Array<{ provider: string; model: string }>;
  currentIndex: number;
  maxRetries: number;
  backoffMs: number;
}

const DEFAULT_FAILOVER_CONFIG = {
  maxRetries: 3,
  backoffMs: 1000,
};

const DEFAULT_CHAINS: Record<string, string[]> = {
  anthropic: ['anthropic', 'openai', 'deepseek'],
  deepseek: ['deepseek', 'anthropic', 'openai'],
  openai: ['openai', 'anthropic', 'deepseek'],
};

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o',
};

export class FailoverPolicy {
  private chains: Record<string, string[]>;
  private defaultModels: Record<string, string>;
  private failureCounts: Map<string, number> = new Map();
  private cooldownUntil: Map<string, number> = new Map();
  private events: FailoverEvent[] = [];
  private maxEvents: number;
  private config: typeof DEFAULT_FAILOVER_CONFIG;

  constructor(
    chains?: Record<string, string[]>,
    models?: Record<string, string>,
    maxEvents = 100
  ) {
    this.chains = chains || DEFAULT_CHAINS;
    this.defaultModels = models || PROVIDER_DEFAULT_MODELS;
    this.maxEvents = maxEvents;
    this.config = DEFAULT_FAILOVER_CONFIG;
  }

  classifyError(error: unknown): FailoverReason {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
      return 'rate_limited';
    }
    if (msg.includes('overload') || msg.includes('503') || msg.includes('529')) {
      return 'server_overloaded';
    }
    if (msg.includes('model') && (msg.includes('not found') || msg.includes('unavailable'))) {
      return 'model_unavailable';
    }
    if (msg.includes('context') && (msg.includes('limit') || msg.includes('overflow'))) {
      return 'context_overflow';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'timeout';
    }
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
      return 'network_error';
    }
    if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('401')) {
      return 'auth_error';
    }
    return 'unknown';
  }

  decideFailover(
    currentProvider: string,
    currentModel: string,
    reason: FailoverReason
  ): { provider: string; model: string } | null {
    // 更新失败计数
    const count = (this.failureCounts.get(currentProvider) || 0) + 1;
    this.failureCounts.set(currentProvider, count);

    // 获取回退链
    const chain = this.chains[currentProvider] || [currentProvider];
    const currentIdx = chain.indexOf(currentProvider);

    // 查找下一个可用 Provider
    for (let i = currentIdx + 1; i < chain.length; i++) {
      const next = chain[i];
      if (this.isProviderAvailable(next)) {
        const nextModel = this.defaultModels[next] || currentModel;
        const event: FailoverEvent = {
          reason,
          fromProvider: currentProvider,
          toProvider: next,
          fromModel: currentModel,
          toModel: nextModel,
          timestamp: Date.now(),
        };
        this.recordEvent(event);
        logger.warning(
          `回退: ${currentProvider}/${currentModel} → ${next}/${nextModel} (原因: ${reason})`
        );
        return { provider: next, model: nextModel };
      }
    }

    // 所有 Provider 都不可用
    logger.error(`所有 Provider 都不可用，当前: ${currentProvider}`);
    return null;
  }

  resetProvider(provider: string): void {
    this.failureCounts.set(provider, 0);
    this.cooldownUntil.delete(provider);
    logger.info(`Provider 重置: ${provider}`);
  }

  setProviderCooldown(provider: string, durationMs: number): void {
    this.cooldownUntil.set(provider, Date.now() + durationMs);
  }

  isProviderAvailable(provider: string): boolean {
    const cooldown = this.cooldownUntil.get(provider);
    if (cooldown && Date.now() < cooldown) {
      return false;
    }
    const failures = this.failureCounts.get(provider) || 0;
    return failures < this.config.maxRetries;
  }

  getFailureCount(provider: string): number {
    return this.failureCounts.get(provider) || 0;
  }

  getEvents(): FailoverEvent[] {
    return [...this.events];
  }

  private recordEvent(event: FailoverEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }
}

function classifyFailoverReason(error: unknown): FailoverReason {
  return new FailoverPolicy().classifyError(error);
}

export { classifyFailoverReason };
