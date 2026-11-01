/**
 * 监控工具
 *
 * Monitor 类提供 metrics 记录和性能计时功能。
 * 日志功能统一使用 monitoring/logs/Logger。
 */

/**
 * 监控数据
 */
export interface MonitoringData {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

/**
 * 监控器类
 */
export class Monitor {
  private metrics: Map<string, number>;

  /**
   * 构造函数
   */
  constructor() {
    this.metrics = new Map();
  }

  /**
   * 记录指标
   * @param name 指标名称
   * @param value 指标值
   * @param tags 标签
   */
  recordMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): void {
    this.metrics.set(name, value);
  }

  /**
   * 获取指标
   * @param name 指标名称
   * @returns 指标值
   */
  getMetric(name: string): number | undefined {
    return this.metrics.get(name);
  }

  /**
   * 记录执行时间
   * @param name 操作名称
   * @param fn 函数
   * @returns 函数返回值
   */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.recordMetric(`${name}_duration`, duration);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.recordMetric(`${name}_duration`, duration);
      this.recordMetric(`${name}_errors`, 1);
      throw error;
    }
  }

  /**
   * 记录执行时间（同步）
   * @param name 操作名称
   * @param fn 函数
   * @returns 函数返回值
   */
  timeSync<T>(name: string, fn: () => T): T {
    const start = Date.now();
    try {
      const result = fn();
      const duration = Date.now() - start;
      this.recordMetric(`${name}_duration`, duration);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.recordMetric(`${name}_duration`, duration);
      this.recordMetric(`${name}_errors`, 1);
      throw error;
    }
  }

  /**
   * 健康检查
   * @returns 健康状态
   */
  healthCheck(): {
    status: string;
    timestamp: number;
    metrics: Record<string, number>;
  } {
    return {
      status: 'healthy',
      timestamp: Date.now(),
      metrics: Object.fromEntries(this.metrics),
    };
  }
}

/**
 * 监控器实例
 */
export const monitor = new Monitor();

/**
 * 获取监控器实例
 * @returns 监控器实例
 */
export function getMonitor(): Monitor {
  return monitor;
}

/**
 * 记录执行时间
 * @param name 操作名称
 * @param fn 函数
 * @returns 函数返回值
 */
export async function time<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return await monitor.time(name, fn);
}

/**
 * 记录执行时间（同步）
 * @param name 操作名称
 * @param fn 函数
 * @returns 函数返回值
 */
export function timeSync<T>(name: string, fn: () => T): T {
  return monitor.timeSync(name, fn);
}
