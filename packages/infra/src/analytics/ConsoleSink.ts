/**
 * Analytics Console Sink
 * 将事件输出到控制台
 */

import type { AnalyticsSink } from './types';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ConsoleSink');

type EventMetadata = Record<string, boolean | number | string | undefined>;

export interface ConsoleSinkOptions {
  enabled?: boolean;
  prefix?: string;
  minLevel?: 'debug' | 'info' | 'warn' | 'error';
  includeTimestamp?: boolean;
  prettyPrint?: boolean;
}

export class ConsoleSink implements AnalyticsSink {
  private enabled: boolean;
  private prefix: string;
  private minLevel: 'debug' | 'info' | 'warn' | 'error';
  private includeTimestamp: boolean;
  private prettyPrint: boolean;
  private eventCount: number = 0;

  constructor(options: ConsoleSinkOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.prefix = options.prefix ?? '[ANALYTICS]';
    this.minLevel = options.minLevel ?? 'info';
    this.includeTimestamp = options.includeTimestamp ?? true;
    this.prettyPrint = options.prettyPrint ?? true;
  }

  logEvent(eventName: string, metadata: EventMetadata): void {
    if (!this.enabled) {
      return;
    }

    this.eventCount++;

    const logEntry = this.formatLogEntry(eventName, metadata);

    logger.info('分析事件', { eventName, logEntry });
  }

  async logEventAsync(
    eventName: string,
    metadata: EventMetadata
  ): Promise<void> {
    this.logEvent(eventName, metadata);
  }

  private formatLogEntry(eventName: string, metadata: EventMetadata): string {
    const parts: string[] = [];

    if (this.includeTimestamp) {
      const timestamp = new Date().toISOString();
      parts.push(`\x1b[90m${timestamp}\x1b[0m`);
    }

    parts.push(`\x1b[36m${this.prefix}\x1b[0m`);

    parts.push(`\x1b[33m${eventName}\x1b[0m`);

    if (this.prettyPrint && Object.keys(metadata).length > 0) {
      const formattedMetadata = this.formatMetadata(metadata);
      parts.push(formattedMetadata);
    } else {
      const simpleMetadata = JSON.stringify(metadata);
      parts.push(simpleMetadata);
    }

    return parts.join(' ');
  }

  private formatMetadata(metadata: EventMetadata): string {
    const entries: string[] = [];

    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined) {
        continue;
      }

      let formattedValue: string;
      if (typeof value === 'string') {
        formattedValue = `"${value}"`;
      } else if (typeof value === 'number') {
        formattedValue = `\x1b[35m${value}\x1b[0m`;
      } else if (typeof value === 'boolean') {
        formattedValue = value ? '\x1b[32mtrue\x1b[0m' : '\x1b[31mfalse\x1b[0m';
      } else {
        formattedValue = JSON.stringify(value);
      }

      entries.push(`\x1b[90m${key}\x1b[0m=${formattedValue}`);
    }

    return `{${entries.join(', ')}}`;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  setMinLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.minLevel = level;
  }

  setIncludeTimestamp(include: boolean): void {
    this.includeTimestamp = include;
  }

  setPrettyPrint(pretty: boolean): void {
    this.prettyPrint = pretty;
  }

  getEventCount(): number {
    return this.eventCount;
  }

  resetEventCount(): void {
    this.eventCount = 0;
  }

  clear(): void {
    this.eventCount = 0;
  }
}

export class NullSink implements AnalyticsSink {
  logEvent(eventName: string, metadata: EventMetadata): void {}

  async logEventAsync(
    eventName: string,
    metadata: EventMetadata
  ): Promise<void> {}
}

export function createConsoleSink(options?: ConsoleSinkOptions): ConsoleSink {
  return new ConsoleSink(options);
}

export function createNullSink(): NullSink {
  return new NullSink();
}
