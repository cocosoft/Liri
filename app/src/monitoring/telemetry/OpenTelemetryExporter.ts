/**
 * OpenTelemetry 遥测导出
 * 导出 Trace/Metrics 到 OTLP endpoint
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface OtelConfig {
  serviceName: string;
  serviceVersion: string;
  otlpEndpoint: string;
  enabled: boolean;
  sampleRate: number;
  batchTimeoutMs: number;
  maxExportBatchSize: number;
}

const DEFAULT_OTEL_CONFIG: OtelConfig = {
  serviceName: 'Liri',
  serviceVersion: '1.0.0',
  otlpEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] || '',
  enabled:
    process.env['ENABLE_OTEL'] === 'true' ||
    !!process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
  sampleRate: 1.0,
  batchTimeoutMs: 5000,
  maxExportBatchSize: 512,
};

export interface OtelSpan {
  name: string;
  startTime: number;
  endTime?: number;
  attributes?: Record<string, string | number | boolean>;
  status: 'ok' | 'error';
  errorMessage?: string;
}

export interface OtelMetric {
  name: string;
  value: number;
  unit: string;
  attributes?: Record<string, string>;
  timestamp: number;
}

export class OpenTelemetryExporter {
  private config: OtelConfig;
  private spans: OtelSpan[] = [];
  private metrics: OtelMetric[] = [];
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<OtelConfig> = {}) {
    this.config = { ...DEFAULT_OTEL_CONFIG, ...config };
  }

  start(): void {
    if (!this.config.enabled) {
      logger.info('OpenTelemetry 未启用');
      return;
    }
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(() => {
      this.flush().catch((e) => {
        logger.error('OTeL 导出失败', e as Error);
      });
    }, this.config.batchTimeoutMs);

    logger.info(
      `OpenTelemetry 导出器已启动 (endpoint: ${this.config.otlpEndpoint || '未配置'})`
    );
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush().catch((e) => {
      logger.error('OTeL 最后导出失败', e as Error);
    });
    logger.info('OpenTelemetry 导出器已停止');
  }

  recordSpan(span: OtelSpan): void {
    if (!this.config.enabled) return;
    this.spans.push({ ...span, startTime: span.startTime || Date.now() });
    if (this.spans.length >= this.config.maxExportBatchSize) {
      this.flush().catch(() => {});
    }
  }

  recordMetric(metric: OtelMetric): void {
    if (!this.config.enabled) return;
    this.metrics.push(metric);
    if (this.metrics.length >= this.config.maxExportBatchSize) {
      this.flush().catch(() => {});
    }
  }

  private async flush(): Promise<void> {
    const spans = this.splicesSpans();
    const metrics = this.splicesMetrics();

    if (spans.length === 0 && metrics.length === 0) return;

    if (!this.config.otlpEndpoint) {
      logger.debug(
        `OTeL 本地记录: ${spans.length} spans, ${metrics.length} metrics`
      );
      return;
    }

    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10000);

      if (spans.length > 0) {
        await fetch(`${this.config.otlpEndpoint}/v1/traces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceSpans: [
              {
                resource: {
                  attributes: [
                    {
                      key: 'service.name',
                      value: { stringValue: this.config.serviceName },
                    },
                    {
                      key: 'service.version',
                      value: { stringValue: this.config.serviceVersion },
                    },
                  ],
                },
                scopeSpans: spans.map((s) => ({
                  spans: [
                    {
                      name: s.name,
                      startTimeUnixNano: String(s.startTime * 1e6),
                      endTimeUnixNano: String((s.endTime || Date.now()) * 1e6),
                      attributes: Object.entries(s.attributes || {}).map(
                        ([k, v]) => ({
                          key: k,
                          value:
                            typeof v === 'number'
                              ? { doubleValue: v }
                              : typeof v === 'boolean'
                                ? { boolValue: v }
                                : { stringValue: String(v) },
                        })
                      ),
                      status: {
                        code: s.status === 'error' ? 2 : 1,
                        message: s.errorMessage || '',
                      },
                    },
                  ],
                })),
              },
            ],
          }),
          signal: controller.signal,
        });
      }

      if (metrics.length > 0) {
        await fetch(`${this.config.otlpEndpoint}/v1/metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceMetrics: [
              {
                resource: {
                  attributes: [
                    {
                      key: 'service.name',
                      value: { stringValue: this.config.serviceName },
                    },
                  ],
                },
                scopeMetrics: metrics.map((m) => ({
                  metrics: [
                    {
                      name: m.name,
                      unit: m.unit,
                      gauge: {
                        dataPoints: [
                          {
                            asDouble: m.value,
                            timeUnixNano: String(m.timestamp * 1e6),
                          },
                        ],
                      },
                    },
                  ],
                })),
              },
            ],
          }),
          signal: controller.signal,
        });
      }
    } catch (error) {
      logger.error('OTeL HTTP 导出失败', error as Error);
      // 回写未导出的数据
      this.spans.unshift(...spans);
      this.metrics.unshift(...metrics);
    }
  }

  private splicesSpans(): OtelSpan[] {
    const batch = this.spans.slice(0, this.config.maxExportBatchSize);
    this.spans = this.spans.slice(this.config.maxExportBatchSize);
    return batch;
  }

  private splicesMetrics(): OtelMetric[] {
    const batch = this.metrics.slice(0, this.config.maxExportBatchSize);
    this.metrics = this.metrics.slice(this.config.maxExportBatchSize);
    return batch;
  }
}

export const otelExporter = new OpenTelemetryExporter();
