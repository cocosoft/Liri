import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { resolvePyappHome } from '@modules/core';

import { getLogger } from '../../monitoring/logs/Logger.js';
const logger = getLogger('config:loader:ConfigLoader');

export type ConfigFormat = 'json' | 'yaml' | 'env';

export interface ConfigSource {
  type: 'file' | 'env' | 'remote';
  path?: string;
  prefix?: string;
  url?: string;
  format?: ConfigFormat;
  priority: number;
  required?: boolean;
}

export interface ConfigLoadResult {
  config: Record<string, unknown>;
  source: string;
  timestamp: number;
}

export type ConfigChangeCallback = (changes: Record<string, unknown>) => void;

export interface IConfigLoader {
  load(sources?: ConfigSource[]): Promise<Record<string, unknown>>;
  parse(content: string, format: ConfigFormat): Record<string, unknown>;
  watch(source: ConfigSource, callback: ConfigChangeCallback): void;
  unwatch(path: string): void;
}

export class ConfigLoader implements IConfigLoader {
  private watchers: Map<
    string,
    {
      source: ConfigSource;
      callback: ConfigChangeCallback;
      interval?: ReturnType<typeof setInterval>;
    }
  > = new Map();
  private defaultSources: ConfigSource[];

  constructor(sources?: ConfigSource[]) {
    this.defaultSources = sources || this.getDefaultSources();
  }

  private getDefaultSources(): ConfigSource[] {
    return [
      { type: 'env', prefix: 'LIRI_', priority: 10, format: 'env' },
      {
        type: 'file',
        path: this.getDefaultConfigPath(),
        priority: 20,
        format: 'json',
        required: false,
      },
    ];
  }

  private getDefaultConfigPath(): string {
    return join(resolvePyappHome(), 'config.json');
  }

  async load(sources?: ConfigSource[]): Promise<Record<string, unknown>> {
    const srcs = sources || this.defaultSources;
    const sorted = [...srcs].sort((a, b) => b.priority - a.priority);

    let merged: Record<string, unknown> = {};

    for (const source of sorted) {
      try {
        const result = await this.loadSource(source);
        merged = this.deepMerge(merged, result);
      } catch (error) {
        if (source.required !== false) {
          throw new AppError(
            `Failed to load config from ${this.describeSource(source)}: ${(error as Error).message}`,
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            '1000'
          );
        }
      }
    }

    return merged;
  }

  private async loadSource(
    source: ConfigSource
  ): Promise<Record<string, unknown>> {
    switch (source.type) {
      case 'file':
        return this.loadFile(source);
      case 'env':
        return this.loadEnv(source);
      case 'remote':
        return this.loadRemote(source);
      default:
        return {};
    }
  }

  private loadFile(source: ConfigSource): Record<string, unknown> {
    const filePath = source.path!;
    if (!existsSync(filePath)) {
      if (source.required) {
        throw new AppError(
          `Config file not found: ${filePath}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
      return {};
    }

    const content = readFileSync(filePath, 'utf-8');
    const format = source.format || this.detectFormat(filePath);
    return this.parse(content, format);
  }

  private loadEnv(source: ConfigSource): Record<string, unknown> {
    const prefix = source.prefix || '';
    const config: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (prefix && !key.startsWith(prefix)) continue;

      const configKey = prefix
        ? key.slice(prefix.length).toLowerCase()
        : key.toLowerCase();
      config[configKey] = this.parseEnvValue(value);
    }

    return config;
  }

  private async loadRemote(
    source: ConfigSource
  ): Promise<Record<string, unknown>> {
    if (!source.url) return {};

    try {
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new AppError(
          `HTTP ${response.status}: ${response.statusText}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
      const text = await response.text();
      const format = source.format || 'json';
      return this.parse(text, format);
    } catch (error) {
      if (source.required) {
        throw error;
      }
      return {};
    }
  }

  parse(content: string, format: ConfigFormat): Record<string, unknown> {
    switch (format) {
      case 'json':
        return JSON.parse(content);
      case 'yaml':
        return this.parseYaml(content);
      case 'env':
        return this.parseEnvContent(content);
      default:
        throw new AppError(
          `Unsupported config format: ${format}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
    }
  }

  private parseYaml(content: string): Record<string, unknown> {
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    let currentKey = '';
    let indentLevel = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.includes(':')) {
        const colonIdx = trimmed.indexOf(':');
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();

        const lineIndent = line.length - line.trimLeft().length;

        if (value === '' || value === '|' || value === '>') {
          currentKey = key;
          indentLevel = lineIndent;
        } else {
          (result as any)[key] = this.parseYamlValue(value);
        }
      }
    }

    return result;
  }

  private parseYamlValue(value: string): any {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    return value.replace(/^['"]|['"]$/g, '');
  }

  private parseEnvContent(content: string): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
      const value = trimmed.slice(eqIdx + 1).trim();
      config[key] = this.parseEnvValue(value);
    }
    return config;
  }

  private parseEnvValue(value: string | undefined): any {
    if (value === undefined || value === '') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    const num = Number(value);
    if (!isNaN(num)) return num;
    return value;
  }

  private detectFormat(filePath: string): ConfigFormat {
    const ext = extname(filePath).toLowerCase();
    switch (ext) {
      case '.json':
        return 'json';
      case '.yaml':
      case '.yml':
        return 'yaml';
      case '.env':
        return 'env';
      default:
        return 'json';
    }
  }

  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  watch(source: ConfigSource, callback: ConfigChangeCallback): void {
    const key = source.path || source.url || source.type;
    if (this.watchers.has(key)) return;

    if (source.type === 'file' && source.path) {
      const interval = setInterval(() => {
        try {
          if (!existsSync(source.path!)) {
            logger.debug('配置文件不存在，跳过轮询检查', { path: source.path });
            return;
          }
          const content = readFileSync(source.path!, 'utf-8');
          const format = source.format || this.detectFormat(source.path!);
          const config = this.parse(content, format);
          callback(config);
          logger.debug('配置文件轮询检查完成', { path: source.path });
        } catch (err) {
          // ignore read errors during watch
          logger.warn('配置文件轮询检查失败', { path: source.path, error: err });

          handleError(err, {
            module: 'config:loader:ConfigLoader',
            action: 'ignoreWatchReadError',
          });
        }
      }, 2000);

      this.watchers.set(key, { source, callback, interval });
    }
  }

  unwatch(path: string): void {
    const watcher = this.watchers.get(path);
    if (watcher) {
      if (watcher.interval) clearInterval(watcher.interval);
      this.watchers.delete(path);
    }
  }

  private describeSource(source: ConfigSource): string {
    switch (source.type) {
      case 'file':
        return `file:${source.path}`;
      case 'env':
        return `env:${source.prefix || '*'}`;
      case 'remote':
        return `remote:${source.url}`;
      default:
        return source.type;
    }
  }
}

let _configLoader: ConfigLoader | undefined;

/**
 * 获取全局 ConfigLoader 单例（懒加载）
 * 避免模块加载时直接实例化导致的循环依赖 TDZ 问题
 */
export function getConfigLoader(): ConfigLoader {
  if (!_configLoader) {
    _configLoader = new ConfigLoader();
  }
  return _configLoader;
}

// 使用 Proxy 保持向后兼容（方法调用时绑定 this 到实际实例）
export const configLoader = new Proxy({} as ConfigLoader, {
  get(_, prop: keyof ConfigLoader) {
    const instance = getConfigLoader();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});
