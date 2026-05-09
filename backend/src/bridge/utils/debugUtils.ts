//
/**
 * 调试工具
 * 负责Bridge系统的调试和错误处理
 */

import { BridgeConfig, PollConfig, BackoffConfig } from '../types';

/**
 * 日志级别
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * 调试请求体
 */
export function debugBody(body: unknown): string {
  try {
    return JSON.stringify(body, null, 2);
  } catch (error) {
    return String(body);
  }
}

/**
 * 提取错误详情
 */
export function extractErrorDetail(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    if ('error' in data && data.error) {
      if (typeof data.error === 'string') {
        return data.error;
      } else if (typeof data.error === 'object' && 'message' in data.error) {
        return String(data.error.message);
      }
    } else if ('message' in data) {
      return String(data.message);
    }
  }
  return undefined;
}

/**
 * 描述Axios错误
 */
export function describeAxiosError(error: unknown): string {
  if (error && typeof error === 'object') {
    if ('message' in error) {
      return String(error.message);
    } else if ('code' in error) {
      return `Axios error code: ${error.code}`;
    }
  }
  return String(error);
}

/**
 * 格式化时间戳
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString();
}

/**
 * 生成调试ID
 */
export function generateDebugId(): string {
  return `debug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 性能计时器
 */
export class PerformanceTimer {
  private startTime: number;
  private name: string;
  private logs: Array<{ timestamp: number; message: string }> = [];

  constructor(name: string) {
    this.name = name;
    this.startTime = Date.now();
    this.log('Started');
  }

  log(message: string): void {
    this.logs.push({
      timestamp: Date.now() - this.startTime,
      message,
    });
  }

  stop(): { durationMs: number; logs: Array<{ timestamp: number; message: string }> } {
    const duration = Date.now() - this.startTime;
    this.log(`Completed in ${duration}ms`);
    return { durationMs: duration, logs: this.logs };
  }

  toString(): string {
    return `${this.name}: ${this.logs.map((l) => `${l.timestamp}ms: ${l.message}`).join(' | ')}`;
  }
}

/**
 * 调试状态检查器
 */
export class DebugStatusChecker {
  /**
   * 检查Bridge配置
   */
  static checkBridgeConfig(config: BridgeConfig): Array<{ type: 'error' | 'warning' | 'info'; message: string }> {
    const issues: Array<{ type: 'error' | 'warning' | 'info'; message: string }> = [];

    if (!config.bridgeId) {
      issues.push({ type: 'error', message: 'bridgeId不能为空' });
    } else if (config.bridgeId.length < 3) {
      issues.push({ type: 'warning', message: 'bridgeId过短' });
    }

    if (!config.machineName) {
      issues.push({ type: 'warning', message: 'machineName为空，使用默认值' });
    }

    if (!config.dir) {
      issues.push({ type: 'error', message: 'dir不能为空' });
    }

    if (config.maxSessions < 1) {
      issues.push({ type: 'error', message: 'maxSessions必须大于0' });
    }

    if (!config.apiBaseUrl) {
      issues.push({ type: 'error', message: 'apiBaseUrl不能为空' });
    } else if (!config.apiBaseUrl.startsWith('https://')) {
      issues.push({ type: 'warning', message: 'apiBaseUrl建议使用HTTPS' });
    }

    return issues;
  }

  /**
   * 检查轮询配置
   */
  static checkPollConfig(config: PollConfig): Array<{ type: 'error' | 'warning' | 'info'; message: string }> {
    const issues: Array<{ type: 'error' | 'warning' | 'info'; message: string }> = [];

    if (config.multisession_poll_interval_ms_at_capacity < 1000) {
      issues.push({ type: 'warning', message: '容量满时轮询间隔过短' });
    }

    if (config.multisession_poll_interval_ms_not_at_capacity < 100) {
      issues.push({ type: 'warning', message: '未满载时轮询间隔过短' });
    }

    return issues;
  }

  /**
   * 检查退避配置
   */
  static checkBackoffConfig(config: BackoffConfig): Array<{ type: 'error' | 'warning' | 'info'; message: string }> {
    const issues: Array<{ type: 'error' | 'warning' | 'info'; message: string }> = [];

    if (config.connInitialMs > config.connCapMs) {
      issues.push({ type: 'error', message: 'connInitialMs不能大于connCapMs' });
    }

    if (config.generalInitialMs > config.generalCapMs) {
      issues.push({ type: 'error', message: 'generalInitialMs不能大于generalCapMs' });
    }

    return issues;
  }

  /**
   * 检查网络连接
   */
  static async checkNetwork(url: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const startTime = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 5000);

      await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      return {
        success: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      clearTimeout(timeout);
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * 调试信息收集器
 */
export class DebugInfoCollector {
  private info: Record<string, unknown> = {};

  add(key: string, value: unknown): void {
    this.info[key] = value;
  }

  addConfig(config: BridgeConfig): void {
    this.info.bridgeConfig = {
      bridgeId: config.bridgeId,
      machineName: config.machineName,
      maxSessions: config.maxSessions,
      workerType: config.workerType,
      apiBaseUrl: config.apiBaseUrl,
      spawnMode: config.spawnMode,
    };
  }

  addEnvironment(): void {
    this.info.environment = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
    };
  }

  addTiming(name: string, durationMs: number): void {
    if (!this.info.timings) {
      this.info.timings = {};
    }
    (this.info.timings as Record<string, number>)[name] = durationMs;
  }

  addError(error: Error): void {
    if (!this.info.errors) {
      this.info.errors = [];
    }
    (this.info.errors as Array<{ message: string; stack: string | undefined }>).push({
      message: error.message,
      stack: error.stack,
    });
  }

  toString(): string {
    return JSON.stringify(this.info, null, 2);
  }

  toObject(): Record<string, unknown> {
    return { ...this.info };
  }
}

/**
 * 安全打印调试信息（隐藏敏感数据）
 */
export function safeDebugLog(obj: unknown): string {
  const sensitiveKeys = ['token', 'secret', 'password', 'accessToken', 'environmentSecret'];
  
  function sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
      for (const key of sensitiveKeys) {
        if (value.toLowerCase().includes(key.toLowerCase())) {
          return '[REDACTED]';
        }
      }
      // 检查是否看起来像token
      if (value.length > 20 && /^[a-zA-Z0-9_-]+$/.test(value)) {
        return value.substring(0, 8) + '...' + value.substring(value.length - 4);
      }
      return value;
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = sanitize(val);
        }
      }
      return result;
    }
    return value;
  }

  return JSON.stringify(sanitize(obj), null, 2);
}

/**
 * 生成调试报告
 */
export function generateDebugReport(
  config: BridgeConfig,
  additionalInfo?: Record<string, unknown>
): string {
  const collector = new DebugInfoCollector();
  collector.addConfig(config);
  collector.addEnvironment();
  
  if (additionalInfo) {
    for (const [key, value] of Object.entries(additionalInfo)) {
      collector.add(key, value);
    }
  }

  return `=== Bridge Debug Report ===
Timestamp: ${new Date().toISOString()}
${'='.repeat(50)}

${collector.toString()}
`;
}

/**
 * 模拟延迟
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 重试函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delayMs: number
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        await delay(delayMs * attempt);
      }
    }
  }
  throw lastError!;
}
