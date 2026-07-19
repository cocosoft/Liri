import type { HealthStatus } from '@modules/core/health/types.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'monitoring:health:HealthChecker',
  level: LogLevel.INFO,
});

export type { HealthStatus };

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  latency: number;
  lastChecked: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  overall: HealthStatus;
  checks: HealthCheck[];
  timestamp: number;
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
    averageLatency: number;
  };
}

export interface HealthCheckDefinition {
  name: string;
  interval: number;
  timeout: number;
  critical: boolean;
  check: () => Promise<{
    status: HealthStatus;
    details?: Record<string, unknown>;
  }>;
}

export interface IHealthChecker {
  registerCheck(
    name: string,
    check: () => Promise<{
      status: HealthStatus;
      details?: Record<string, unknown>;
    }>,
    options?: Partial<Omit<HealthCheckDefinition, 'name' | 'check'>>
  ): void;
  unregisterCheck(name: string): boolean;
  runCheck(name: string): Promise<HealthCheck | undefined>;
  runAllChecks(): Promise<HealthCheckResult>;
  getLastResult(): HealthCheckResult | undefined;
  getCheckHistory(name: string): HealthCheck[];
  startAutoCheck(intervalMs: number): void;
  stopAutoCheck(): void;
}

export class HealthChecker implements IHealthChecker {
  private definitions: Map<string, HealthCheckDefinition> = new Map();
  private history: Map<string, HealthCheck[]> = new Map();
  private lastResult: HealthCheckResult | undefined;
  private autoTimer: NodeJS.Timeout | null = null;
  private maxHistoryPerCheck = 100;

  registerCheck(
    name: string,
    check: () => Promise<{
      status: HealthStatus;
      details?: Record<string, unknown>;
    }>,
    options?: Partial<Omit<HealthCheckDefinition, 'name' | 'check'>>
  ): void {
    this.definitions.set(name, {
      name,
      check,
      interval: options?.interval ?? 30000,
      timeout: options?.timeout ?? 5000,
      critical: options?.critical ?? false,
    });
  }

  unregisterCheck(name: string): boolean {
    this.definitions.delete(name);
    return !this.definitions.has(name);
  }

  async runCheck(name: string): Promise<HealthCheck | undefined> {
    const def = this.definitions.get(name);
    if (!def) return undefined;

    const start = Date.now();
    try {
      const result = await Promise.race([
        def.check(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`健康检查超时 (${def.timeout}ms)`)),
            def.timeout
          )
        ),
      ]);
      const latency = Date.now() - start;
      const check: HealthCheck = {
        name,
        status: result.status,
        latency,
        lastChecked: start,
        details: result.details,
      };
      this.recordHistory(check);
      return check;
    } catch (error) {
      const latency = Date.now() - start;
      const check: HealthCheck = {
        name,
        status: 'unhealthy',
        latency,
        lastChecked: start,
        error: error instanceof Error ? error.message : String(error),
      };
      this.recordHistory(check);
      return check;
    }
  }

  async runAllChecks(): Promise<HealthCheckResult> {
    const checks = await Promise.all(
      Array.from(this.definitions.keys()).map((name) => this.runCheck(name))
    );
    const validChecks = checks.filter((c): c is HealthCheck => c !== undefined);
    const result = this.aggregateResults(validChecks);
    this.lastResult = result;
    return result;
  }

  getLastResult(): HealthCheckResult | undefined {
    return this.lastResult;
  }

  getCheckHistory(name: string): HealthCheck[] {
    return this.history.get(name) || [];
  }

  startAutoCheck(intervalMs: number): void {
    this.stopAutoCheck();
    this.autoTimer = setInterval(() => {
      this.runAllChecks();
    }, intervalMs);
  }

  stopAutoCheck(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  private recordHistory(check: HealthCheck): void {
    if (!this.history.has(check.name)) {
      this.history.set(check.name, []);
    }
    const history = this.history.get(check.name)!;
    history.push(check);
    if (history.length > this.maxHistoryPerCheck) {
      history.splice(0, history.length - this.maxHistoryPerCheck);
    }
  }

  private aggregateResults(checks: HealthCheck[]): HealthCheckResult {
    const statusOrder: Record<string, number> = {
      healthy: 0,
      degraded: 1,
      unhealthy: 2,
      unknown: 3,
    };

    const summary: HealthCheckResult['summary'] = {
      total: checks.length,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      unknown: 0,
      averageLatency: 0,
    };

    let worst: HealthStatus = 'healthy';

    for (const c of checks) {
      if (c.status in summary) {
        (summary as Record<string, number>)[c.status]++;
      }
      if (statusOrder[c.status] > statusOrder[worst]) worst = c.status;
    }

    if (checks.length > 0) {
      const totalLatency = checks.reduce((s, c) => s + c.latency, 0);
      summary.averageLatency = Math.round(totalLatency / checks.length);
    }

    return { overall: worst, checks, timestamp: Date.now(), summary };
  }
}
