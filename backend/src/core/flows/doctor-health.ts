import type {
  HealthCheckResult,
  HealthCheckReport,
  FlowConfigProvider,
} from './types.js';

export type HealthCheck = {
  name: string;
  severity: 'info' | 'warning' | 'error';
  check: (
    configProvider: FlowConfigProvider
  ) => HealthCheckResult | Promise<HealthCheckResult>;
};

const healthChecks: Map<string, HealthCheck> = new Map();

const DEFAULT_HEALTH_CHECKS: HealthCheck[] = [
  {
    name: 'config:exists',
    severity: 'error',
    check: (configProvider) => ({
      ok: configProvider.get<unknown>('version') !== undefined,
      check: 'config:exists',
      message: 'Configuration file exists and is loadable',
      severity: 'error',
    }),
  },
  {
    name: 'config:has-agent',
    severity: 'warning',
    check: (configProvider) => {
      const agentId = configProvider.get<string>('agents.defaults.id');
      return {
        ok: !!agentId,
        check: 'config:has-agent',
        message: agentId
          ? `Default agent: ${agentId}`
          : 'No default agent configured',
        severity: 'warning',
      };
    },
  },
  {
    name: 'channels:configured',
    severity: 'info',
    check: (configProvider) => {
      const channels = configProvider.get<Record<string, unknown>>('channels');
      const channelCount = channels ? Object.keys(channels).length : 0;
      return {
        ok: channelCount > 0,
        check: 'channels:configured',
        message: `${channelCount} channel(s) configured`,
        severity: 'info',
      };
    },
  },
  {
    name: 'plugins:configured',
    severity: 'info',
    check: (configProvider) => {
      const plugins = configProvider.get<unknown[]>('plugins.enabled');
      const pluginCount = Array.isArray(plugins) ? plugins.length : 0;
      return {
        ok: true,
        check: 'plugins:configured',
        message: `${pluginCount} plugin(s) enabled`,
        severity: 'info',
      };
    },
  },
  {
    name: 'model:configured',
    severity: 'warning',
    check: (configProvider) => {
      const model = configProvider.get<string>('agents.defaults.model');
      return {
        ok: !!model,
        check: 'model:configured',
        message: model
          ? `Default model: ${model}`
          : 'No default model configured',
        severity: 'warning',
      };
    },
  },
];

/**
 * 注册健康检查项。
 */
export function registerHealthCheck(check: HealthCheck): void {
  healthChecks.set(check.name, check);
}

/**
 * 批量注册健康检查项。
 */
export function registerHealthChecks(checks: HealthCheck[]): void {
  for (const check of checks) {
    registerHealthCheck(check);
  }
}

/**
 * 注销健康检查项。
 */
export function unregisterHealthCheck(name: string): boolean {
  return healthChecks.delete(name);
}

/**
 * 初始化默认健康检查。
 */
export function initializeDefaultHealthChecks(): void {
  for (const check of DEFAULT_HEALTH_CHECKS) {
    if (!healthChecks.has(check.name)) {
      registerHealthCheck(check);
    }
  }
}

/**
 * 运行所有已注册的健康检查。
 */
export async function runHealthChecks(
  configProvider: FlowConfigProvider
): Promise<HealthCheckReport> {
  initializeDefaultHealthChecks();

  const results: HealthCheckResult[] = [];
  const checks = Array.from(healthChecks.values());

  for (const healthCheck of checks) {
    try {
      const result = await healthCheck.check(configProvider);
      results.push(result);
    } catch (err) {
      results.push({
        ok: false,
        check: healthCheck.name,
        message: err instanceof Error ? err.message : String(err),
        severity: healthCheck.severity,
      });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const warnings = results.filter(
    (r) => !r.ok && r.severity === 'warning'
  ).length;
  const errors = results.filter((r) => !r.ok && r.severity === 'error').length;

  return {
    timestamp: Date.now(),
    checks: results,
    summary: {
      total: results.length,
      passed,
      warnings,
      errors,
    },
  };
}

/**
 * 列出所有已注册的健康检查名称。
 */
export function listHealthChecks(): string[] {
  return Array.from(healthChecks.keys());
}
