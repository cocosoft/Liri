import { existsSync, readFileSync, watchFile, unwatchFile, Stats } from 'fs';
import { extname } from 'path';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '../../monitoring/logs/Logger.js';
const logger = new Logger({
  module: 'config:hotreload:HotReloader',
  level: LogLevel.INFO,
});

export type ReloadStrategy = 'watch' | 'poll' | 'manual';

export interface ReloadEvent {
  config: Record<string, unknown>;
  changedKeys: string[];
  previousConfig: Record<string, unknown>;
  timestamp: number;
  source: string;
}

export interface ReloadResult {
  success: boolean;
  event?: ReloadEvent;
  error?: string;
  duration: number;
}

export type ReloadListener = (event: ReloadEvent) => void;
export type ReloadErrorListener = (
  error: Error,
  previousConfig: Record<string, unknown>
) => void;

export interface HotReloadConfig {
  strategy: ReloadStrategy;
  pollInterval: number;
  maxRetries: number;
  retryDelay: number;
  enableRollback: boolean;
  debounceMs: number;
}

const defaultConfig: HotReloadConfig = {
  strategy: 'poll',
  pollInterval: 2000,
  maxRetries: 2,
  retryDelay: 500,
  enableRollback: true,
  debounceMs: 300,
};

export class HotReloader {
  private config: HotReloadConfig;
  private listeners: Set<ReloadListener> = new Set();
  private errorListeners: Set<ReloadErrorListener> = new Set();
  private currentConfig: Record<string, unknown> = {};
  private previousConfig: Record<string, unknown> = {};
  private isReloading: boolean = false;
  private watchPaths: Set<string> = new Set();
  private lastReloadTime: number = 0;
  private reloadCount: number = 0;
  private rollbackCount: number = 0;
  private loadFn: (() => Promise<Record<string, unknown>>) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(customConfig?: Partial<HotReloadConfig>) {
    this.config = { ...defaultConfig, ...customConfig };
  }

  updateConfig(cfg: Partial<HotReloadConfig>): void {
    Object.assign(this.config, cfg);
  }

  setLoadFn(fn: () => Promise<Record<string, unknown>>): void {
    this.loadFn = fn;
  }

  setInitialConfig(config: Record<string, unknown>): void {
    this.currentConfig = { ...config };
    this.previousConfig = { ...config };
  }

  onReload(listener: ReloadListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onError(listener: ReloadErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  watchFile(filePath: string): void {
    if (this.watchPaths.has(filePath)) return;
    this.watchPaths.add(filePath);

    if (this.config.strategy === 'watch' && this.config.enableRollback) {
      watchFile(
        filePath,
        { interval: this.config.pollInterval, persistent: false },
        (curr: Stats, prev: Stats) => {
          if (curr.mtimeMs <= prev.mtimeMs) return;
          this.scheduleReload(filePath);
        }
      );
    }
  }

  unwatchFile(filePath: string): void {
    if (this.watchPaths.has(filePath)) {
      unwatchFile(filePath);
      this.watchPaths.delete(filePath);
    }
  }

  private scheduleReload(source: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.triggerReload(source);
    }, this.config.debounceMs);
  }

  async triggerReload(source: string): Promise<ReloadResult> {
    if (this.isReloading) {
      return {
        success: false,
        error: 'Reload already in progress',
        duration: 0,
      };
    }

    const startTime = Date.now();
    this.isReloading = true;

    this.previousConfig = { ...this.currentConfig };

    try {
      if (!this.loadFn) {
        throw new AppError(
          'No load function configured',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const newConfig = await this.loadFn();
      const changedKeys = this.detectChanges(this.currentConfig, newConfig);

      if (changedKeys.length === 0) {
        this.isReloading = false;
        return { success: true, duration: Date.now() - startTime };
      }

      this.currentConfig = { ...newConfig };
      this.lastReloadTime = Date.now();
      this.reloadCount++;

      const event: ReloadEvent = {
        config: { ...newConfig },
        changedKeys,
        previousConfig: { ...this.previousConfig },
        timestamp: this.lastReloadTime,
        source,
      };

      this.notifyListeners(event);

      this.isReloading = false;
      return { success: true, event, duration: Date.now() - startTime };
    } catch (error) {
      if (
        this.config.enableRollback &&
        Object.keys(this.previousConfig).length > 0
      ) {
        this.currentConfig = { ...this.previousConfig };
        this.rollbackCount++;
        this.notifyError(error as Error, this.previousConfig);
      }

      this.isReloading = false;
      return {
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  private detectChanges(
    oldCfg: Record<string, unknown>,
    newCfg: Record<string, unknown>,
    prefix = ''
  ): string[] {
    const changes: string[] = [];
    const allKeys = new Set([...Object.keys(oldCfg), ...Object.keys(newCfg)]);

    for (const key of allKeys) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const oldVal = oldCfg[key];
      const newVal = newCfg[key];

      if (oldVal === undefined && newVal !== undefined) {
        changes.push(fullKey);
      } else if (newVal === undefined && oldVal !== undefined) {
        changes.push(fullKey);
      } else if (
        typeof oldVal === 'object' &&
        typeof newVal === 'object' &&
        oldVal !== null &&
        newVal !== null &&
        !Array.isArray(oldVal) &&
        !Array.isArray(newVal)
      ) {
        changes.push(
          ...this.detectChanges(
            oldVal as Record<string, unknown>,
            newVal as Record<string, unknown>,
            fullKey
          )
        );
      } else if (oldVal !== newVal) {
        changes.push(fullKey);
      }
    }

    return changes;
  }

  private notifyListeners(event: ReloadEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // ignore listener errors

        logger.debug('Operation skipped', {
          context: 'ignore listener errors',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private notifyError(
    error: Error,
    previousConfig: Record<string, unknown>
  ): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error, previousConfig);
      } catch (err) {
        // ignore listener errors

        logger.debug('Operation skipped', {
          context: 'ignore listener errors',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  getCurrentConfig(): Record<string, unknown> {
    return { ...this.currentConfig };
  }

  getPreviousConfig(): Record<string, unknown> {
    return { ...this.previousConfig };
  }

  getStats(): {
    reloadCount: number;
    rollbackCount: number;
    lastReloadTime: number;
    isReloading: boolean;
    watchedPaths: number;
  } {
    return {
      reloadCount: this.reloadCount,
      rollbackCount: this.rollbackCount,
      lastReloadTime: this.lastReloadTime,
      isReloading: this.isReloading,
      watchedPaths: this.watchPaths.size,
    };
  }

  destroy(): void {
    for (const filePath of this.watchPaths) {
      unwatchFile(filePath);
    }
    this.watchPaths.clear();
    this.listeners.clear();
    this.errorListeners.clear();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.isReloading = false;
  }
}

export const hotReloader = new HotReloader();
