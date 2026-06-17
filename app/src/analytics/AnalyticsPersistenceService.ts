import { appendFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { configManager } from '@modules/config';
import { resolveDataSubDir } from '@modules/core/paths';
import type { AnalyticsEvent } from './types';
import type { StructuredAnalyticsEvent } from './AnalyticsSchema';
import {
  AnalyticsCategory,
  AnalyticsSeverity,
  getCategoryForEvent,
} from './AnalyticsSchema';

export interface StorageConfig {
  baseDir: string;
  maxFileSize: number;
  rotationCount: number;
  enabled: boolean;
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  baseDir:
    configManager.env('ANALYTICS_STORAGE_DIR') ||
    resolveDataSubDir('analytics'),
  maxFileSize: 50 * 1024 * 1024,
  rotationCount: 5,
  enabled: configManager.env('ANALYTICS_PERSISTENCE_ENABLED') !== 'false',
};

export class AnalyticsPersistenceService {
  private config: StorageConfig;
  private currentFile: string;
  private currentFileSize: number = 0;
  private initialized: boolean = false;

  constructor(config?: Partial<StorageConfig>) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    this.currentFile = this.getLogFilePath(0);
  }

  private getLogFilePath(index: number): string {
    const date = new Date().toISOString().split('T')[0];
    return join(this.config.baseDir, `analytics_${date}_${index}.jsonl`);
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;
    await mkdir(this.config.baseDir, { recursive: true });
    this.initialized = true;
  }

  async persistEvent(event: StructuredAnalyticsEvent): Promise<void> {
    if (!this.initialized || !this.config.enabled) return;

    try {
      const record = {
        ...event,
        _written: Date.now(),
      };
      const line = JSON.stringify(record) + '\n';

      if (this.currentFileSize + line.length > this.config.maxFileSize) {
        this.currentFileSize = 0;
        const timestamp = Date.now();
        this.currentFile = join(
          this.config.baseDir,
          `analytics_${new Date().toISOString().split('T')[0]}_${timestamp}.jsonl`
        );
      }

      await appendFile(this.currentFile, line, { encoding: 'utf-8' });
      this.currentFileSize += line.length;
    } catch (error) {
      console.error('[AnalyticsPersistence] Failed to persist event:', error);
    }
  }

  async persistEvents(events: StructuredAnalyticsEvent[]): Promise<void> {
    if (!this.initialized || !this.config.enabled) return;
    for (const event of events) {
      await this.persistEvent(event);
    }
  }

  async queryEvents(options: {
    category?: AnalyticsCategory;
    severity?: AnalyticsSeverity;
    eventName?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<StructuredAnalyticsEvent[]> {
    if (!this.initialized) return [];

    const results: StructuredAnalyticsEvent[] = [];
    const limit = options.limit ?? 100;

    try {
      const date = new Date().toISOString().split('T')[0];
      const filePath = join(this.config.baseDir, `analytics_${date}_0.jsonl`);
      const content = await readFile(filePath, { encoding: 'utf-8' }).catch(
        () => ''
      );
      if (!content) return [];

      const lines = content.trim().split('\n');
      for (const line of lines) {
        if (results.length >= limit) break;
        try {
          const event = JSON.parse(line) as StructuredAnalyticsEvent;
          if (options.category && event.category !== options.category) continue;
          if (options.severity && event.severity !== options.severity) continue;
          if (options.eventName && event.eventName !== options.eventName)
            continue;
          if (options.startTime && event.timestamp < options.startTime)
            continue;
          if (options.endTime && event.timestamp > options.endTime) continue;
          results.push(event);
        } catch {
          continue;
        }
      }
    } catch {
      return [];
    }

    return results;
  }

  async getStats(): Promise<{
    totalEvents: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    latestTimestamp: number;
  }> {
    const stats = {
      totalEvents: 0,
      byCategory: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      latestTimestamp: 0,
    };

    try {
      const date = new Date().toISOString().split('T')[0];
      const filePath = join(this.config.baseDir, `analytics_${date}_0.jsonl`);
      const content = await readFile(filePath, { encoding: 'utf-8' }).catch(
        () => ''
      );
      if (!content) return stats;

      for (const line of content.trim().split('\n')) {
        try {
          const event = JSON.parse(line) as StructuredAnalyticsEvent;
          stats.totalEvents++;
          stats.byCategory[event.category] =
            (stats.byCategory[event.category] || 0) + 1;
          stats.bySeverity[event.severity] =
            (stats.bySeverity[event.severity] || 0) + 1;
          if (event.timestamp > stats.latestTimestamp) {
            stats.latestTimestamp = event.timestamp;
          }
        } catch {
          continue;
        }
      }
    } catch {
      return stats;
    }

    return stats;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
