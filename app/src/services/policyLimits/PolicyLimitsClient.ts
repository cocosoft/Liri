import type { PolicyDefinition, PolicyLimitConfig, UsageQuota } from './types';
import { DEFAULT_POLICY_CONFIG, LimitType } from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'services:policyLimits:PolicyLimitsClient', level: LogLevel.INFO });

export class PolicyLimitsClient {
  private config: PolicyLimitConfig;
  private policies: Map<LimitType, PolicyDefinition> = new Map();
  private lastFetchTime: number = 0;
  private initialized: boolean = false;

  constructor(config?: Partial<PolicyLimitConfig>) {
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config };
    if (config?.defaultLimits) {
      this.config.defaultLimits = new Map([
        ...DEFAULT_POLICY_CONFIG.defaultLimits,
        ...config.defaultLimits,
      ]);
    }
    this.policies = new Map(this.config.defaultLimits);
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!this.config.enabled || !this.config.apiUrl) {
      return;
    }

    await this.fetchPolicies();
  }

  async fetchPolicies(): Promise<void> {
    if (!this.config.apiUrl) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout
      );

      const response = await fetch(this.config.apiUrl, {
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'X-API-Key': this.config.apiKey }),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) return;

      const data = (await response.json()) as { policies?: PolicyDefinition[] };

      if (data.policies && Array.isArray(data.policies)) {
        for (const policy of data.policies) {
          this.policies.set(policy.type, policy);
        }
        this.lastFetchTime = Date.now();
      }
    } catch (err) {

      // Fallback to defaults

      logger.debug("Operation skipped", { context: "Fallback to defaults", error: err instanceof Error ? err.message : String(err) });

    }
  }

  getPolicy(type: LimitType): PolicyDefinition | undefined {
    return this.policies.get(type);
  }

  getAllPolicies(): ReadonlyMap<LimitType, PolicyDefinition> {
    return this.policies;
  }

  getLimit(type: LimitType): number {
    const policy = this.policies.get(type);
    if (!policy) return Infinity;

    if (typeof policy.value === 'number') {
      return policy.value;
    }

    return Infinity;
  }

  getToolBlacklist(): string[] {
    const policy = this.policies.get(LimitType.TOOL_BLACKLIST);
    if (policy && Array.isArray(policy.value)) {
      return policy.value as string[];
    }
    return [];
  }

  isToolBlocked(toolName: string): boolean {
    const blacklist = this.getToolBlacklist();
    return blacklist.includes(toolName);
  }

  getModelRestrictions(): string[] {
    const policy = this.policies.get(LimitType.MODEL_RESTRICTIONS);
    if (policy && Array.isArray(policy.value)) {
      return policy.value as string[];
    }
    return [];
  }

  isModelRestricted(model: string): boolean {
    const restrictions = this.getModelRestrictions();
    if (restrictions.length === 0) return false;
    return !restrictions.some((r) =>
      model.toLowerCase().includes(r.toLowerCase())
    );
  }

  destroy(): void {
    this.policies.clear();
    this.initialized = false;
  }
}

export function getPolicyLimitsClient(
  config?: Partial<PolicyLimitConfig>
): PolicyLimitsClient {
  return new PolicyLimitsClient(config);
}
