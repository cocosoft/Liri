/**
 * 控制台导出器
 * 提供指标和追踪数据的控制台输出
 */

import { logForDebugging } from '@modules/utils/debug.js';

/**
 * 导出数据
 */
export interface ExportData {
  timestamp: number;
  type: 'metric' | 'trace' | 'log' | 'event';
  name: string;
  value: any;
  attributes?: Record<string, any>;
}

/**
 * 控制台导出器配置
 */
export interface ConsoleExporterConfig {
  enabled: boolean;
  prettyPrint: boolean;
  includeTimestamp: boolean;
}

/**
 * 控制台导出器
 */
export class ConsoleExporter {
  private config: ConsoleExporterConfig;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<ConsoleExporterConfig>) {
    this.config = {
      enabled: true,
      prettyPrint: true,
      includeTimestamp: true,
      ...config,
    };
  }

  /**
   * 导出数据到控制台
   * @param data 导出数据
   */
  export(data: ExportData): void {
    if (!this.config.enabled) {
      return;
    }

    const timestamp = this.config.includeTimestamp
      ? `[${new Date(data.timestamp).toISOString()}] `
      : '';

    const prefix = `${timestamp}[${data.type.toUpperCase()}] ${data.name}`;

    if (this.config.prettyPrint) {
      console.log(`${prefix}:`);
      console.log(JSON.stringify(data.value, null, 2));
      if (data.attributes && Object.keys(data.attributes).length > 0) {
        console.log('Attributes:', JSON.stringify(data.attributes, null, 2));
      }
      console.log('---');
    } else {
      console.log(`${prefix}: ${JSON.stringify(data.value)}`);
    }
  }

  /**
   * 导出指标
   * @param name 指标名称
   * @param value 指标值
   * @param attributes 属性
   */
  exportMetric(
    name: string,
    value: any,
    attributes?: Record<string, any>
  ): void {
    this.export({
      timestamp: Date.now(),
      type: 'metric',
      name,
      value,
      attributes,
    });
  }

  /**
   * 导出追踪
   * @param name 追踪名称
   * @param value 追踪值
   * @param attributes 属性
   */
  exportTrace(
    name: string,
    value: any,
    attributes?: Record<string, any>
  ): void {
    this.export({
      timestamp: Date.now(),
      type: 'trace',
      name,
      value,
      attributes,
    });
  }

  /**
   * 导出日志
   * @param name 日志名称
   * @param value 日志值
   * @param attributes 属性
   */
  exportLog(name: string, value: any, attributes?: Record<string, any>): void {
    this.export({
      timestamp: Date.now(),
      type: 'log',
      name,
      value,
      attributes,
    });
  }

  /**
   * 导出事件
   * @param name 事件名称
   * @param value 事件值
   * @param attributes 属性
   */
  exportEvent(
    name: string,
    value: any,
    attributes?: Record<string, any>
  ): void {
    this.export({
      timestamp: Date.now(),
      type: 'event',
      name,
      value,
      attributes,
    });
  }

  /**
   * 设置配置
   * @param config 配置
   */
  setConfig(config: Partial<ConsoleExporterConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取配置
   * @returns 配置
   */
  getConfig(): ConsoleExporterConfig {
    return { ...this.config };
  }
}

/**
 * 全局控制台导出器实例
 */
let consoleExporter: ConsoleExporter | null = null;

/**
 * 获取控制台导出器实例
 * @returns 控制台导出器实例
 */
export function getConsoleExporter(): ConsoleExporter {
  if (!consoleExporter) {
    consoleExporter = new ConsoleExporter();
  }
  return consoleExporter;
}

/**
 * 创建控制台导出器实例
 * @param config 配置
 * @returns 控制台导出器实例
 */
export function createConsoleExporter(
  config?: Partial<ConsoleExporterConfig>
): ConsoleExporter {
  return new ConsoleExporter(config);
}
