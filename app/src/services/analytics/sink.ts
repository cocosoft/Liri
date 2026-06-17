/**
 * 分析事件路由
 *
 * 将分析事件路由到不同的后端（日志文件、控制台、HTTP端点）。
 * 参考 CC源码 cc_code/backend/services/analytics/sink.ts
 */

import { isAnalyticsDisabled } from './config';
import { attachAnalyticsSink } from './index';
import type { AnalyticsSink } from './index';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { configManager } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

type LogEventMetadata = Record<string, boolean | number | string | undefined>;

class ConsoleSink implements AnalyticsSink {
  logEvent(eventName: string, metadata: LogEventMetadata): void {
    if (!isAnalyticsDisabled()) {
      logger.info(`[Analytics] ${eventName}`, JSON.stringify(metadata));
    }
  }

  async logEventAsync(
    eventName: string,
    metadata: LogEventMetadata
  ): Promise<void> {
    this.logEvent(eventName, metadata);
  }
}

class FileSink implements AnalyticsSink {
  private events: Array<{
    eventName: string;
    metadata: LogEventMetadata;
    timestamp: string;
  }> = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private flushPath: string;

  constructor(flushPath?: string) {
    this.flushPath = flushPath || configManager.env('ANALYTICS_LOG_PATH') || '';
    if (this.flushPath) {
      this.flushInterval = setInterval(() => this.flush(), 30000);
    }
  }

  logEvent(eventName: string, metadata: LogEventMetadata): void {
    if (!isAnalyticsDisabled()) {
      this.events.push({
        eventName,
        metadata,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async logEventAsync(
    eventName: string,
    metadata: LogEventMetadata
  ): Promise<void> {
    this.logEvent(eventName, metadata);
    if (this.events.length >= 100) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.events.length === 0 || !this.flushPath) return;

    const batch = this.events.splice(0, this.events.length);
    try {
      const fs = await import('fs/promises');
      const lines = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(this.flushPath, lines, 'utf-8');
    } catch {
      // 写入失败时静默处理
    }
  }

  dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}

export function initializeAnalyticsSink(options?: {
  type?: 'console' | 'file';
  flushPath?: string;
}): void {
  const type =
    options?.type || configManager.env('ANALYTICS_SINK_TYPE') || 'console';

  let sink: AnalyticsSink;
  switch (type) {
    case 'file':
      sink = new FileSink(options?.flushPath);
      break;
    case 'console':
    default:
      sink = new ConsoleSink();
      break;
  }

  attachAnalyticsSink(sink);
}
