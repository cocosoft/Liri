//
/**
 * 多导出器管理
 * 实现OTLP、Prometheus等导出器的配置和管理
 */

import {
  NodeTracerProvider,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 导出器类型
 */
export type ExporterType = 'otlp' | 'otlp-http' | 'prometheus' | 'console';

/**
 * 导出器配置
 */
export interface ExporterConfig {
  otlp?: {
    endpoint?: string;
    protocol?: 'grpc' | 'http';
    headers?: Record<string, string>;
  };
  prometheus?: {
    port?: number;
    host?: string;
    endpoint?: string;
  };
  console?: {
    verbose?: boolean;
  };
}

/**
 * 导出器管理器
 */
export class ExporterManager {
  private static instance: ExporterManager;
  private exporters: Map<ExporterType, any> = new Map();
  private config: ExporterConfig;

  private constructor(config: ExporterConfig) {
    this.config = config;
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: ExporterConfig): ExporterManager {
    if (!ExporterManager.instance) {
      ExporterManager.instance = new ExporterManager(config || {});
    }
    return ExporterManager.instance;
  }

  /**
   * 初始化导出器
   */
  async initializeExporters(tracerProvider: NodeTracerProvider): Promise<void> {
    // 初始化OTLP导出器
    if (this.config.otlp) {
      const otlpConfig = this.config.otlp;
      if (otlpConfig.protocol === 'http') {
        const otlpExporter = new OTLPTraceExporterHttp({
          url: otlpConfig.endpoint || 'http://localhost:4318/v1/traces',
          headers: otlpConfig.headers,
        });
        (tracerProvider as any).addSpanProcessor(
          new BatchSpanProcessor(otlpExporter)
        );
        this.exporters.set('otlp-http', otlpExporter);
        logger.info('OTLP HTTP exporter initialized');
      } else {
        try {
          const { OTLPTraceExporter: OTLPGrpcExporter } =
            // @ts-expect-error - optional dependency, handled in try-catch
            await import('@opentelemetry/exporter-trace-otlp-grpc');
          const grpcExporter = new OTLPGrpcExporter({
            url: otlpConfig.endpoint || 'http://localhost:4317',
            headers: otlpConfig.headers,
          });
          (tracerProvider as any).addSpanProcessor(
            new BatchSpanProcessor(grpcExporter)
          );
          this.exporters.set('otlp', grpcExporter);
          logger.info('OTLP gRPC exporter initialized');
        } catch {
          logger.warning('OTLP gRPC exporter not available');
        }
      }
    }

    // 初始化Prometheus导出器
    if (this.config.prometheus) {
      try {
        const { PrometheusExporter } =
          // @ts-expect-error - optional dependency, handled in try-catch
          await import('@opentelemetry/exporter-prometheus');
        const prometheusConfig = this.config.prometheus;
        const prometheusExporter = new PrometheusExporter({
          port: prometheusConfig.port || 9464,
          host: prometheusConfig.host || 'localhost',
          endpoint: prometheusConfig.endpoint || '/metrics',
        });
        (tracerProvider as any).addSpanProcessor(
          new SimpleSpanProcessor(prometheusExporter)
        );
        this.exporters.set('prometheus', prometheusExporter);
        logger.info(
          `Prometheus exporter initialized on ${prometheusConfig.host || 'localhost'}:${prometheusConfig.port || 9464}${prometheusConfig.endpoint || '/metrics'}`
        );
      } catch {
        logger.warning('Prometheus exporter not available');
      }
    }

    // 初始化Console导出器
    if (this.config.console) {
      const consoleExporter = new ConsoleSpanExporter();
      (tracerProvider as any).addSpanProcessor(
        new SimpleSpanProcessor(consoleExporter)
      );
      this.exporters.set('console', consoleExporter);
      logger.info('Console exporter initialized');
    }
  }

  /**
   * 获取导出器
   */
  getExporter(type: ExporterType): any {
    return this.exporters.get(type);
  }

  /**
   * 检查导出器是否存在
   */
  hasExporter(type: ExporterType): boolean {
    return this.exporters.has(type);
  }

  /**
   * 获取所有导出器
   */
  getAllExporters(): Map<ExporterType, any> {
    return new Map(this.exporters);
  }

  /**
   * 关闭所有导出器
   */
  async shutdownExporters(): Promise<void> {
    for (const [type, exporter] of this.exporters) {
      if (exporter.shutdown) {
        try {
          await exporter.shutdown();
          logger.info(`Exporter ${type} shutdown`);
        } catch (error) {
          logger.error(
            `Failed to shutdown exporter ${type}`,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }
    this.exporters.clear();
  }

  /**
   * 设置配置
   */
  setConfig(config: ExporterConfig): void {
    this.config = config;
  }

  /**
   * 获取配置
   */
  getConfig(): ExporterConfig {
    return { ...this.config };
  }

  /**
   * 重新初始化导出器
   */
  reinitializeExporters(tracerProvider: NodeTracerProvider): void {
    // 先关闭现有导出器
    this.shutdownExporters().then(() => {
      // 重新初始化
      this.initializeExporters(tracerProvider);
    });
  }
}

/**
 * 获取导出器管理器实例
 */
export function getExporterManager(config?: ExporterConfig): ExporterManager {
  return ExporterManager.getInstance(config);
}

/**
 * 导出器工具函数
 */
export class ExporterUtils {
  /**
   * 创建默认导出器配置
   */
  static createDefaultConfig(): ExporterConfig {
    return {
      console: {
        verbose: false,
      },
    };
  }

  /**
   * 从环境变量创建配置
   */
  static createConfigFromEnv(): ExporterConfig {
    const config: ExporterConfig = {};

    // OTLP配置
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      config.otlp = {
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        protocol:
          (process.env.OTEL_EXPORTER_OTLP_PROTOCOL as 'grpc' | 'http') ||
          'grpc',
      };
    }

    // Prometheus配置
    if (process.env.PROMETHEUS_PORT) {
      config.prometheus = {
        port: parseInt(process.env.PROMETHEUS_PORT, 10),
        host: process.env.PROMETHEUS_HOST,
        endpoint: process.env.PROMETHEUS_ENDPOINT,
      };
    }

    // Console配置
    if (process.env.OTEL_EXPORTER_CONSOLE_ENABLED === 'true') {
      config.console = {
        verbose: process.env.OTEL_EXPORTER_CONSOLE_VERBOSE === 'true',
      };
    }

    return config;
  }

  /**
   * 验证导出器配置
   */
  static validateConfig(config: ExporterConfig): boolean {
    // 简单验证
    if (config.otlp) {
      if (
        config.otlp.protocol &&
        !['grpc', 'http'].includes(config.otlp.protocol)
      ) {
        logger.error('Invalid OTLP protocol');
        return false;
      }
    }

    if (config.prometheus) {
      if (
        config.prometheus.port &&
        (isNaN(config.prometheus.port) ||
          config.prometheus.port < 1 ||
          config.prometheus.port > 65535)
      ) {
        logger.error('Invalid Prometheus port');
        return false;
      }
    }

    return true;
  }
}
