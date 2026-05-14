/**
 * ConfigIO 配置读写管理
 * 对标 CC 的配置 I/O 机制
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 配置格式
 */
export type ConfigFormat = 'json' | 'yaml' | 'toml';

/**
 * 配置作用域
 */
export type ConfigScope = 'global' | 'project' | 'local';

/**
 * 配置来源
 */
export interface ConfigSource {
  scope: ConfigScope;
  path: string;
  priority: number;
  format: ConfigFormat;
  exists: boolean;
}

/**
 * 配置读取选项
 */
export interface ConfigReadOptions {
  merge: boolean;
  defaults: Record<string, unknown>;
}

/**
 * I/O 结果
 */
export interface IOResult {
  success: boolean;
  config: Record<string, unknown>;
  sources: ConfigSource[];
  error?: string;
}

/**
 * 配置 I/O 管理器
 */
export class ConfigIO {
  private configDir: string;
  private sources: ConfigSource[] = [];

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(process.cwd(), '.pyapp');
    this.initSources();
  }

  /**
   * 读取配置
   */
  readAll(options?: ConfigReadOptions): IOResult {
    const merged: Record<string, unknown> = options?.defaults ? { ...options.defaults } : {};

    for (const source of this.sources.sort((a, b) => b.priority - a.priority)) {
      if (source.exists) {
        try {
          const data = this.readFile(source.path, source.format);
          Object.assign(merged, data);
        } catch {
        }
      }
    }

    return { success: true, config: merged, sources: this.sources };
  }

  /**
   * 写入配置
   */
  write(config: Record<string, unknown>, scope: ConfigScope = 'local'): IOResult {
    const source = this.sources.find((s) => s.scope === scope);

    if (!source) {
      return {
        success: false,
        config: {},
        sources: this.sources,
        error: `未找到作用域 ${scope} 的配置源`,
      };
    }

    try {
      const existing: Record<string, unknown> = source.exists
        ? this.readFile(source.path, source.format)
        : {};

      Object.assign(existing, config);
      this.writeFile(source.path, source.format, existing);

      return { success: true, config: existing, sources: this.sources };
    } catch (err) {
      return {
        success: false,
        config: {},
        sources: this.sources,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 读取单个配置源
   */
  readSource(scope: ConfigScope): Record<string, unknown> {
    const source = this.sources.find((s) => s.scope === scope);

    if (!source || !source.exists) {
      return {};
    }

    try {
      return this.readFile(source.path, source.format);
    } catch {
      return {};
    }
  }

  /**
   * 初始化配置源
   */
  private initSources(): void {
    this.sources = [
      {
        scope: 'global',
        path: path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.pyapp', 'config.json'),
        priority: 10,
        format: 'json',
        exists: false,
      },
      {
        scope: 'project',
        path: path.join(this.configDir, 'config.json'),
        priority: 20,
        format: 'json',
        exists: false,
      },
      {
        scope: 'local',
        path: path.join(process.cwd(), '.pyapp.local.json'),
        priority: 30,
        format: 'json',
        exists: false,
      },
    ];

    for (const source of this.sources) {
      source.exists = fs.existsSync(source.path);
    }
  }

  /**
   * 读取文件
   */
  private readFile(filePath: string, format: ConfigFormat): Record<string, unknown> {
    const content = fs.readFileSync(filePath, 'utf-8');

    switch (format) {
      case 'json':
        return JSON.parse(content);
      default:
        return JSON.parse(content);
    }
  }

  /**
   * 写入文件
   */
  private writeFile(filePath: string, format: ConfigFormat, data: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

export const configIO = new ConfigIO();
