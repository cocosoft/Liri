/**
 * 模型健康检查模块
 * 周期检查模型可用性，支持多个 Provider
 * 对齐 OpenClaw agents/auth-health.ts
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'unknown';

export interface ProviderHealth {
  provider: string;
  model: string;
  status: ProviderHealthStatus;
  lastChecked: number;
  latencyMs: number;
  errorMessage?: string;
  consecutiveFailures: number;
}

export interface HealthCheckConfig {
  providers: string[];
  checkIntervalMs: number;
  failureThreshold: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  providers: ['anthropic', 'deepseek', 'openai'],
  checkIntervalMs: 60000,
  failureThreshold: 3,
  timeoutMs: 10000,
};

export class ModelHealthChecker {
  private config: HealthCheckConfig;
  private health: Map<string, ProviderHealth> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: Partial<HealthCheckConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    for (const provider of this.config.providers) {
      this.health.set(provider, {
        provider,
        model: 'default',
        status: 'unknown',
        lastChecked: 0,
        latencyMs: 0,
        consecutiveFailures: 0,
      });
    }

    this.timer = setInterval(() => {
      this.runChecks().catch((e) => {
        logger.error('健康检查轮次失败', e as Error);
      });
    }, this.config.checkIntervalMs);

    // 首次立即运行
    this.runChecks().catch((e) => {
      logger.error('首次健康检查失败', e as Error);
    });

    logger.info(`模型健康检查已启动 (间隔: ${this.config.checkIntervalMs}ms)`);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('模型健康检查已停止');
  }

  getHealth(provider: string): ProviderHealth | undefined {
    return this.health.get(provider);
  }

  getAllHealth(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  getHealthyProviders(): string[] {
    return Array.from(this.health.entries())
      .filter(([, h]) => h.status === 'healthy' || h.status === 'degraded')
      .map(([p]) => p);
  }

  getUnhealthyProviders(): string[] {
    return Array.from(this.health.entries())
      .filter(([, h]) => h.status === 'unavailable')
      .map(([p]) => p);
  }

  private async runChecks(): Promise<void> {
    for (const provider of this.config.providers) {
      try {
        const startTime = Date.now();
        const healthy = await this.pingProvider(provider);
        const latencyMs = Date.now() - startTime;

        const current = this.health.get(provider) || {
          provider,
          model: 'default',
          status: 'unknown' as ProviderHealthStatus,
          lastChecked: 0,
          latencyMs: 0,
          consecutiveFailures: 0,
        };

        if (healthy) {
          this.health.set(provider, {
            ...current,
            status: 'healthy',
            lastChecked: Date.now(),
            latencyMs,
            consecutiveFailures: 0,
            errorMessage: undefined,
          });
        } else {
          const failures = current.consecutiveFailures + 1;
          const status: ProviderHealthStatus =
            failures >= this.config.failureThreshold
              ? 'unavailable'
              : 'degraded';
          this.health.set(provider, {
            ...current,
            status,
            lastChecked: Date.now(),
            latencyMs,
            consecutiveFailures: failures,
            errorMessage: `${provider} 响应超时`,
          });
          logger.warning(
            `模型健康检查失败: ${provider} (${failures}/${this.config.failureThreshold})`
          );
        }
      } catch (error) {
        logger.error(`模型健康检查异常: ${provider}`, error as Error);
      }
    }
  }

  private async pingProvider(provider: string): Promise<boolean> {
    const apiKeyEnv = this.getApiKeyEnv(provider);
    if (!apiKeyEnv) {
      logger.debug(`跳过 ${provider} 健康检查: 无 API Key`);
      return false;
    }

    // 简易 ping——不发送完整请求
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs
      );

      const urls: Record<string, string> = {
        anthropic: 'https://api.anthropic.com/',
        deepseek: 'https://api.deepseek.com/',
        openai: 'https://api.openai.com/',
      };
      const url = urls[provider] || urls['anthropic'];

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok || response.status === 403;
    } catch {
      return false;
    }
  }

  private getApiKeyEnv(provider: string): string | undefined {
    const keyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      openai: 'OPENAI_API_KEY',
    };
    return process.env[keyMap[provider]];
  }
}

export const modelHealthChecker = new ModelHealthChecker();
