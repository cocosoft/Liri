/**
 * 凭证健康检查
 * 对标 Hermes 凭证健康检查机制
 * 验证 API 凭证的有效性
 */

/**
 * 健康检查结果
 */
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'ai:credentials:CredentialHealth',
  level: LogLevel.INFO,
});

export interface CredentialHealthResult {
  healthy: boolean;
  statusCode?: number;
  error?: string;
  latencyMs: number;
  checkedAt: number;
}

/**
 * 健康检查配置
 */
export interface HealthCheckConfig {
  checkIntervalMs: number;
  timeoutMs: number;
  testEndpoint?: string;
}

/**
 * 默认配置
 */
const DEFAULT_HEALTH_CONFIG: HealthCheckConfig = {
  checkIntervalMs: 300_000,
  timeoutMs: 10_000,
};

/**
 * 凭证健康检查器
 */
export class CredentialHealth {
  private healthCache: Map<string, CredentialHealthResult> = new Map();
  private config: HealthCheckConfig;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<HealthCheckConfig>) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  /**
   * 检查凭证健康状态
   * @param apiKey API Key
   * @param endpoint 测试端点
   * @returns 健康检查结果
   */
  async check(
    apiKey: string,
    endpoint: string = 'https://api.openai.com/v1/models'
  ): Promise<CredentialHealthResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: 'HEAD',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      const result: CredentialHealthResult = {
        healthy: response.ok,
        statusCode: response.status,
        latencyMs: Date.now() - startTime,
        checkedAt: Date.now(),
      };

      this.healthCache.set(apiKey, result);

      return result;
    } catch (err) {
      const result: CredentialHealthResult = {
        healthy: false,
        error: err instanceof Error ? err.message : '检查失败',
        latencyMs: Date.now() - startTime,
        checkedAt: Date.now(),
      };

      this.healthCache.set(apiKey, result);

      return result;
    }
  }

  /**
   * 获取缓存的健康状态
   * @param apiKey API Key
   * @returns 健康结果或 null
   */
  getCachedHealth(apiKey: string): CredentialHealthResult | null {
    const cached = this.healthCache.get(apiKey);
    if (!cached) return null;

    const elapsed = Date.now() - cached.checkedAt;
    if (elapsed > this.config.checkIntervalMs) {
      return null;
    }

    return cached;
  }

  /**
   * 批量检查凭证
   * @param apiKeys API Key 列表
   * @returns 健康结果列表
   */
  async checkBatch(apiKeys: string[]): Promise<CredentialHealthResult[]> {
    const results: CredentialHealthResult[] = [];

    for (const key of apiKeys) {
      const result = await this.check(key);
      results.push(result);
    }

    return results;
  }

  /**
   * 获取健康统计
   */
  getStats(): { total: number; healthy: number; unhealthy: number } {
    const results = Array.from(this.healthCache.values());

    return {
      total: results.length,
      healthy: results.filter((r) => r.healthy).length,
      unhealthy: results.filter((r) => !r.healthy).length,
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.healthCache.clear();
  }
}
