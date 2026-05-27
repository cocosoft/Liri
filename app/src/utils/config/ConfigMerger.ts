/**
 * 配置合并和覆盖策略
 */

import { logger } from '../log.js';

export enum MergeStrategy {
  OVERRIDE = 'override',
  DEEP_MERGE = 'deep_merge',
  ARRAY_CONCAT = 'array_concat',
  ARRAY_REPLACE = 'array_replace',
  PRESERVE = 'preserve',
}

export interface MergeOptions {
  strategy: MergeStrategy;
  arrayStrategy?: MergeStrategy;
  cloneDeep?: boolean;
}

export interface ConfigLayer {
  source: string;
  priority: number;
  config: Record<string, unknown>;
}

export class ConfigMerger {
  private layers: ConfigLayer[] = [];

  addLayer(
    source: string,
    config: Record<string, unknown>,
    priority?: number
  ): void {
    const layer: ConfigLayer = {
      source,
      priority: priority ?? this.layers.length,
      config,
    };
    this.layers.push(layer);
    this.sortLayers();
  }

  removeLayer(source: string): void {
    this.layers = this.layers.filter((l) => l.source !== source);
  }

  getLayers(): ConfigLayer[] {
    return [...this.layers];
  }

  private sortLayers(): void {
    this.layers.sort((a, b) => b.priority - a.priority);
  }

  merge(options?: Partial<MergeOptions>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const layer of this.layers) {
      result;
    }

    return result;
  }

  mergeWithStrategy(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
    options: MergeOptions
  ): Record<string, unknown> {
    const result: Record<string, unknown> = this.cloneDeep(base);

    for (const [key, value] of Object.entries(override)) {
      const baseValue = result[key];

      if (
        options.strategy === MergeStrategy.DEEP_MERGE &&
        this.isObject(baseValue) &&
        this.isObject(value)
      ) {
        result[key] = this.mergeWithStrategy(
          baseValue as Record<string, unknown>,
          value as Record<string, unknown>,
          options
        );
      } else if (
        options.strategy === MergeStrategy.ARRAY_CONCAT &&
        Array.isArray(baseValue) &&
        Array.isArray(value)
      ) {
        result[key] = [...baseValue, ...value];
      } else if (
        options.strategy === MergeStrategy.ARRAY_REPLACE &&
        Array.isArray(value)
      ) {
        result[key] = this.cloneDeep(value);
      } else if (options.strategy === MergeStrategy.PRESERVE) {
        if (!(key in result)) {
          result[key] = this.cloneDeep(value);
        }
      } else {
        result[key] = this.cloneDeep(value);
      }
    }

    return result;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private cloneDeep<T>(value: T): T {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.cloneDeep(item)) as T;
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = this.cloneDeep(val);
    }
    return result as T;
  }
}

export class ConfigOverrideManager {
  private overrides: Map<string, { value: unknown; source: string }> =
    new Map();
  private originalValues: Map<string, unknown> = new Map();

  setOverride(key: string, value: unknown, source: string = 'runtime'): void {
    if (!this.originalValues.has(key)) {
      const current = this.overrides.get(key);
      if (current) {
        this.originalValues.set(key, current.value);
      }
    }
    this.overrides.set(key, { value, source });
  }

  getOverride(key: string): unknown {
    return this.overrides.get(key)?.value;
  }

  removeOverride(key: string): boolean {
    const original = this.originalValues.get(key);
    if (original !== undefined) {
      this.overrides.set(key, { value: original, source: 'original' });
      this.originalValues.delete(key);
      return true;
    }
    return this.overrides.delete(key);
  }

  clearOverrides(): void {
    for (const [key, { value }] of this.overrides) {
      this.originalValues.set(key, value);
    }
  }

  applyOverrides(config: Record<string, unknown>): Record<string, unknown> {
    const result = { ...config };

    for (const [key, { value }] of this.overrides) {
      result[key] = value;
    }

    return result;
  }

  getOverrideSources(): Map<string, string> {
    const sources = new Map<string, string>();
    for (const [key, { source }] of this.overrides) {
      sources.set(key, source);
    }
    return sources;
  }
}

let globalOverrideManager: ConfigOverrideManager | null = null;

export function getGlobalOverrideManager(): ConfigOverrideManager {
  if (!globalOverrideManager) {
    globalOverrideManager = new ConfigOverrideManager();
  }
  return globalOverrideManager;
}

export function resetGlobalOverrideManager(): void {
  globalOverrideManager = null;
}

export function mergeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  strategy: MergeStrategy = MergeStrategy.OVERRIDE
): Record<string, unknown> {
  const merger = new ConfigMerger();
  return merger.mergeWithStrategy(base, override, { strategy });
}

export function deepMergeConfigs(
  base: Record<string, unknown>,
  ...overrides: Record<string, unknown>[]
): Record<string, unknown> {
  let result = base;
  for (const override of overrides) {
    result = mergeConfigs(result, override, MergeStrategy.DEEP_MERGE);
  }
  return result;
}
