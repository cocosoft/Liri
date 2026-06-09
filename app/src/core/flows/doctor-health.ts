import type {
  HealthCheckResult,
  HealthCheckReport,
  FlowConfigProvider,
} from './types.js';
import { HealthChecker } from '../../monitoring/health/HealthChecker.js';

/**
 * @deprecated 请使用 monitoring/health/HealthChecker 注册新的健康检查。
 * doctor-health 是 flows 模块的适配层，新健康检查应直接注册到 HealthChecker。
 */
export type HealthCheck = {
  name: string;
  severity: 'info' | 'warning' | 'error';
  check: (
    configProvider: FlowConfigProvider
  ) => HealthCheckResult | Promise<HealthCheckResult>;
};

/** 共享的 HealthChecker 实例，用于统一健康检查注册 */
const healthChecker = new HealthChecker();

/** 获取共享的 HealthChecker 实例 */
export function getHealthChecker(): HealthChecker {
  return healthChecker;
}

/** 运行时的 configProvider，在 runHealthChecks 时注入 */
let currentConfigProvider: FlowConfigProvider | null = null;

/** 将 flow 的 HealthCheckResult severity 映射为 HealthChecker 的 HealthStatus */
function toHealthStatus(
  ok: boolean,
  severity: 'info' | 'warning' | 'error'
): 'healthy' | 'degraded' | 'unhealthy' | 'unknown' {
  if (ok) return 'healthy';
  switch (severity) {
    case 'error':   return 'unhealthy';
    case 'warning': return 'degraded';
    case 'info':    return 'healthy';
  }
}

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
 * 同时代理到 HealthChecker，确保统一的健康检查视图。
 */
export function registerHealthCheck(check: HealthCheck): void {
  healthChecks.set(check.name, check);

  // 代理到 HealthChecker，使 flows 的检查对 monitoring 系统可见
  healthChecker.registerCheck(
    `flows:${check.name}`,
    async () => {
      const cp = currentConfigProvider;
      if (!cp) return { status: 'unknown' as const };
      const result = await check.check(cp);
      return {
        status: toHealthStatus(result.ok, result.severity),
        details: { message: result.message ?? '', check: result.check, severity: result.severity },
      };
    },
    { critical: check.severity === 'error' }
  );
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
  healthChecker.unregisterCheck(`flows:${name}`);
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
  currentConfigProvider = configProvider;
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

  // 同步运行 HealthChecker，利用其超时/历史记录能力
  await healthChecker.runAllChecks();

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
