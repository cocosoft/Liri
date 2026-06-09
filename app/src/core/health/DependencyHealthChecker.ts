/**
 * 依赖健康度检查
 * 对标平安科技，增加对 Redis/DB/外部 API 等依赖的健康检查能力
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 依赖类型
 */
export type DependencyType =
  | 'redis'
  | 'database'
  | 'api'
  | 'file_system'
  | 'process';

import type { HealthStatus } from './types.js';
export type { HealthStatus };

/**
 * 依赖健康结果
 */
export interface DependencyHealthResult {
  type: DependencyType;
  name: string;
  status: HealthStatus;
  latencyMs: number;
  message: string;
  checkedAt: number;
}

/**
 * 依赖健康配置
 */
export interface DependencyHealthConfig {
  checkIntervalMs: number;
  defaultTimeoutMs: number;
  endpoints: Record<string, string>;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: DependencyHealthConfig = {
  checkIntervalMs: 60_000,
  defaultTimeoutMs: 5000,
  endpoints: {},
};

/**
 * 依赖健康度检查器
 */
export class DependencyHealthChecker {
  private config: DependencyHealthConfig;
  private results: DependencyHealthResult[] = [];
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<DependencyHealthConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查 Redis 可用性
   * @param host Redis 主机
   * @param port Redis 端口
   * @returns 健康结果
   */
  async checkRedis(
    host: string = '127.0.0.1',
    port: number = 6379
  ): Promise<DependencyHealthResult> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.defaultTimeoutMs
      );

      const response = await fetch(`http://${host}:${port}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      return {
        type: 'redis',
        name: `Redis (${host}:${port})`,
        status: response.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - startTime,
        message: response.ok
          ? 'Redis 可达'
          : `Redis 响应异常: ${response.status}`,
        checkedAt: Date.now(),
      };
    } catch {
      return {
        type: 'redis',
        name: `Redis (${host}:${port})`,
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        message: 'Redis 不可达',
        checkedAt: Date.now(),
      };
    }
  }

  /**
   * 检查数据库可用性
   * @param dbPath 数据库路径
   * @returns 健康结果
   */
  async checkDatabase(dbPath: string): Promise<DependencyHealthResult> {
    const startTime = Date.now();

    try {
      const exists = fs.existsSync(dbPath);
      const stats = exists ? fs.statSync(dbPath) : null;

      return {
        type: 'database',
        name: `Database (${path.basename(dbPath)})`,
        status: exists ? 'healthy' : 'unhealthy',
        latencyMs: Date.now() - startTime,
        message: exists
          ? `数据库可用 (${stats ? (stats.size / 1024).toFixed(1) + 'KB' : '未知大小'})`
          : '数据库文件不存在',
        checkedAt: Date.now(),
      };
    } catch {
      return {
        type: 'database',
        name: `Database (${path.basename(dbPath)})`,
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        message: '数据库不可读',
        checkedAt: Date.now(),
      };
    }
  }

  /**
   * 检查外部 API 可用性
   * @param name API 名称
   * @param url API URL
   * @returns 健康结果
   */
  async checkAPI(name: string, url: string): Promise<DependencyHealthResult> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.defaultTimeoutMs
      );

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const status: HealthStatus = response.ok
        ? 'healthy'
        : response.status === 429
          ? 'degraded'
          : 'unhealthy';

      return {
        type: 'api',
        name: name,
        status,
        latencyMs: Date.now() - startTime,
        message: `${url} → ${response.status}`,
        checkedAt: Date.now(),
      };
    } catch (err) {
      return {
        type: 'api',
        name: name,
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        message: `${url} → ${err instanceof Error ? err.message : '不可达'}`,
        checkedAt: Date.now(),
      };
    }
  }

  /**
   * 检查文件系统可用性
   * @param paths 路径列表
   * @returns 健康结果
   */
  async checkFileSystem(paths: string[]): Promise<DependencyHealthResult[]> {
    return paths.map((p) => {
      const startTime = Date.now();
      const exists = fs.existsSync(p);
      const writable = exists ? this.checkWritable(p) : false;

      return {
        type: 'file_system' as DependencyType,
        name: `FS: ${p}`,
        status:
          exists && writable ? 'healthy' : exists ? 'degraded' : 'unhealthy',
        latencyMs: Date.now() - startTime,
        message: exists ? (writable ? '可读写' : '只读') : '路径不存在',
        checkedAt: Date.now(),
      };
    });
  }

  /**
   * 运行全部健康检查
   * @param customChecks 自定义检查
   * @returns 健康结果列表
   */
  async runAll(
    customChecks?: Array<() => Promise<DependencyHealthResult>>
  ): Promise<DependencyHealthResult[]> {
    const results: DependencyHealthResult[] = [];

    if (process.env['REDIS_HOST']) {
      const redisResult = await this.checkRedis(
        process.env['REDIS_HOST'],
        parseInt(process.env['REDIS_PORT'] || '6379', 10)
      );
      results.push(redisResult);
    }

    const apiEndpoints = this.config.endpoints;
    for (const [name, url] of Object.entries(apiEndpoints)) {
      results.push(await this.checkAPI(name, url));
    }

    if (customChecks) {
      for (const check of customChecks) {
        results.push(await check());
      }
    }

    this.results = results;

    return results;
  }

  /**
   * 获取上次检查结果
   */
  getLastResults(): DependencyHealthResult[] {
    return [...this.results];
  }

  /**
   * 获取总体健康状态
   */
  getOverallStatus(): HealthStatus {
    if (this.results.length === 0) return 'unknown';

    const hasUnhealthy = this.results.some((r) => r.status === 'unhealthy');
    const hasDegraded = this.results.some((r) => r.status === 'degraded');

    if (hasUnhealthy) return 'unhealthy';
    if (hasDegraded) return 'degraded';

    return 'healthy';
  }

  /**
   * 启动定时检查
   */
  startPeriodicCheck(): void {
    if (this.checkTimer) return;

    this.checkTimer = setInterval(() => {
      this.runAll().catch(() => {});
    }, this.config.checkIntervalMs);
  }

  /**
   * 停止定时检查
   */
  stopPeriodicCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * 检查路径是否可写
   */
  private checkWritable(p: string): boolean {
    try {
      const testFile = path.join(p, '.health_check_test');
      fs.writeFileSync(testFile, 'ok', { flag: 'w' });
      fs.unlinkSync(testFile);

      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 全局依赖健康检查器实例
 */
let globalChecker: DependencyHealthChecker | null = null;

/**
 * 获取全局依赖健康检查器
 */
export function getDependencyHealthChecker(): DependencyHealthChecker {
  if (!globalChecker) {
    globalChecker = new DependencyHealthChecker();
  }

  return globalChecker;
}
