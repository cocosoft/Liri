/**
 * AI Failover Policy
 * 对标OpenClaw agents/failover-policy.ts
 * 故障转移策略管理
 */

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

export interface FailoverPolicyConfig {
  maxRetries: number;
  backoffMs: number;
  maxBackoffMs: number;
  jitterFactor: number;
  monitorIntervalMs: number;
}

const DEFAULT_CONFIG: FailoverPolicyConfig = {
  maxRetries: 3,
  backoffMs: 1000,
  maxBackoffMs: 30000,
  jitterFactor: 0.1,
  monitorIntervalMs: 60000,
};

const DEFAULT_PROVIDER_CHAINS: Record<string, string[]> = {
  anthropic: ['anthropic', 'openai', 'deepseek', 'google'],
  openai: ['openai', 'anthropic', 'deepseek', 'google'],
  deepseek: ['deepseek', 'anthropic', 'openai', 'google'],
  google: ['google', 'anthropic', 'openai', 'deepseek'],
};

const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  deepseek: 'deepseek-chat',
  google: 'gemini-2.0-flash',
};

export class FailoverManager {
  private chains: Record<string, string[]>;
  private models: Record<string, string>;
  private config: FailoverPolicyConfig;
  private failureCounts: Map<string, number> = new Map();
  private cooldownUntil: Map<string, number> = new Map();
  private events: FailoverEvent[] = [];
  private healthStatus: Map<string, boolean> = new Map();

  constructor(config?: Partial<FailoverPolicyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chains = { ...DEFAULT_PROVIDER_CHAINS };
    this.models = { ...DEFAULT_PROVIDER_MODELS };
  }

  async execute<T>(
    provider: string,
    operation: (provider: string) => Promise<T>,
    options?: { model?: string; reason?: FailoverReason }
  ): Promise<{ result: T; provider: string; model: string }> {
    const chain = this.getChain(provider);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < chain.length; attempt++) {
      const currentProvider = chain[attempt];
      const currentModel = options?.model ?? this.models[currentProvider] ?? '';

      if (this.isOnCooldown(currentProvider)) {
        continue;
      }

      try {
        const result = await operation(currentProvider);

        this.recordSuccess(currentProvider);
        return { result, provider: currentProvider, model: currentModel };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const reason = this.classifyError(lastError);
        this.recordFailure(currentProvider, reason);

        if (attempt < chain.length - 1) {
          const event: FailoverEvent = {
            reason,
            fromProvider: currentProvider,
            toProvider: chain[attempt + 1],
            fromModel: currentModel,
            toModel: options?.model ?? this.models[chain[attempt + 1]] ?? '',
            timestamp: Date.now(),
            errorMessage: lastError.message,
          };

          this.events.push(event);
          this.setCooldown(currentProvider);

          const backoff = this.calculateBackoff(attempt);
          await this.sleep(backoff);
        }
      }
    }

    throw lastError ?? new Error('All providers failed');
  }

  getChain(provider: string): string[] {
    return this.chains[provider] ?? [provider];
  }

  setChain(provider: string, fallbacks: string[]): void {
    this.chains[provider] = [provider, ...fallbacks];
  }

  setModel(provider: string, model: string): void {
    this.models[provider] = model;
  }

  getModel(provider: string): string {
    return this.models[provider] ?? '';
  }

  isAvailable(provider: string): boolean {
    if (this.isOnCooldown(provider)) return false;
    return this.healthStatus.get(provider) ?? true;
  }

  markUnavailable(provider: string, reason: FailoverReason): void {
    this.healthStatus.set(provider, false);
    this.setCooldown(provider);
    this.recordFailure(provider, reason);
  }

  markAvailable(provider: string): void {
    this.healthStatus.set(provider, true);
    this.failureCounts.delete(provider);
    this.cooldownUntil.delete(provider);
  }

  getEvents(limit?: number): FailoverEvent[] {
    const events = [...this.events].reverse();
    return limit ? events.slice(0, limit) : events;
  }

  getFailureCount(provider: string): number {
    return this.failureCounts.get(provider) ?? 0;
  }

  getStats(): {
    totalFailures: number;
    totalEvents: number;
    activeCooldowns: number;
    unavailableProviders: string[];
  } {
    return {
      totalFailures: Array.from(this.failureCounts.values()).reduce(
        (a, b) => a + b,
        0
      ),
      totalEvents: this.events.length,
      activeCooldowns: Array.from(this.cooldownUntil.entries()).filter(
        ([, until]) => until > Date.now()
      ).length,
      unavailableProviders: Array.from(this.healthStatus.entries())
        .filter(([, available]) => !available)
        .map(([p]) => p),
    };
  }

  updateConfig(config: Partial<FailoverPolicyConfig>): void {
    Object.assign(this.config, config);
  }

  getConfig(): FailoverPolicyConfig {
    return { ...this.config };
  }

  resetEvents(): void {
    this.events = [];
  }

  resetAll(): void {
    this.failureCounts.clear();
    this.cooldownUntil.clear();
    this.events = [];
    this.healthStatus.clear();
  }

  private classifyError(error: Error): FailoverReason {
    const msg = error.message.toLowerCase();

    if (
      msg.includes('rate') ||
      msg.includes('429') ||
      msg.includes('too many')
    ) {
      return 'rate_limited';
    }

    if (
      msg.includes('overload') ||
      msg.includes('503') ||
      msg.includes('unavailable')
    ) {
      return 'server_overloaded';
    }

    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'timeout';
    }

    if (
      msg.includes('auth') ||
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('api key')
    ) {
      return 'auth_error';
    }

    if (
      msg.includes('context') ||
      msg.includes('token') ||
      msg.includes('length')
    ) {
      return 'context_overflow';
    }

    if (
      msg.includes('model') &&
      (msg.includes('not found') || msg.includes('unavailable'))
    ) {
      return 'model_unavailable';
    }

    if (
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound')
    ) {
      return 'network_error';
    }

    return 'unknown';
  }

  private recordSuccess(provider: string): void {
    this.failureCounts.delete(provider);
    this.cooldownUntil.delete(provider);
    this.healthStatus.set(provider, true);
  }

  private recordFailure(provider: string, reason: FailoverReason): void {
    const count = (this.failureCounts.get(provider) ?? 0) + 1;
    this.failureCounts.set(provider, count);
  }

  private isOnCooldown(provider: string): boolean {
    const until = this.cooldownUntil.get(provider);
    return until !== undefined && until > Date.now();
  }

  private setCooldown(provider: string): void {
    const count = this.failureCounts.get(provider) ?? 0;
    const backoff = Math.min(
      this.config.backoffMs * Math.pow(2, count),
      this.config.maxBackoffMs
    );

    const jitter = backoff * this.config.jitterFactor * (Math.random() * 2 - 1);
    this.cooldownUntil.set(provider, Date.now() + backoff + jitter);
  }

  private calculateBackoff(attempt: number): number {
    const backoff = this.config.backoffMs * Math.pow(2, attempt);
    const jitter = backoff * this.config.jitterFactor * (Math.random() * 2 - 1);
    return Math.min(backoff + jitter, this.config.maxBackoffMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createFailoverManager(
  config?: Partial<FailoverPolicyConfig>
): FailoverManager {
  return new FailoverManager(config);
}

export function classifyFailoverReason(error: unknown): FailoverReason {
  const msg =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (msg.includes('rate') || msg.includes('429') || msg.includes('too many')) {
    return 'rate_limited';
  }
  if (msg.includes('overload') || msg.includes('503') || msg.includes('unavailable')) {
    return 'server_overloaded';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  if (msg.includes('auth') || msg.includes('401') || msg.includes('403')) {
    return 'auth_error';
  }
  if (msg.includes('context') || msg.includes('token') || msg.includes('length')) {
    return 'context_overflow';
  }
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('unavailable'))) {
    return 'model_unavailable';
  }
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return 'network_error';
  }
  return 'unknown';
}
