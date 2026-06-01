/**
 * ConfigIO 配置读写管理
 * 提供文件锁、原子写入等 I/O 安全机制
 */
import fs from 'node:fs';
import path from 'node:path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolvePyappHome, resolveProjectRoot } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

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
  private lockTimeout: number = 10000;
  private locks: Map<string, boolean> = new Map();

  constructor(configDir?: string, lockTimeout?: number) {
    this.configDir = configDir || resolvePyappHome();
    this.lockTimeout = lockTimeout ?? 10000;
    this.initSources();
  }

  /**
   * 获取文件锁
   * 使用 .lock 文件实现进程级互斥
   * @param lockPath 锁文件路径
   * @returns 是否成功获取锁
   */
  acquireLock(lockPath: string): boolean {
    const startTime = Date.now();

    while (Date.now() - startTime < this.lockTimeout) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.closeSync(fd);
        this.locks.set(lockPath, true);
        return true;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // 检查锁是否过期（>10秒的锁视为过期）
          try {
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > this.lockTimeout) {
              fs.unlinkSync(lockPath);
              continue;
            }
          } catch {
            // 锁文件已被删除
          }
          // 短暂等待后重试
          const elapsed = Date.now() - startTime;
          if (elapsed < this.lockTimeout) {
            const waitMs = Math.min(100, this.lockTimeout - elapsed);
            Atomics.wait(
              new Int32Array(new SharedArrayBuffer(4)),
              0,
              0,
              waitMs
            );
          }
          continue;
        }
        // EPERM: 权限不足（如 Windows 用户目录），降级为无锁模式
        if (error.code === 'EPERM') {
          logger.debug('文件锁获取失败（EPERM），降级为无锁模式', { lockPath });
          return true;
        }
        logger.warn('获取文件锁失败', { lockPath, error: String(error) });
        return false;
      }
    }

    logger.warn('获取文件锁超时', { lockPath, timeoutMs: this.lockTimeout });
    return false;
  }

  /**
   * 释放文件锁
   * @param lockPath 锁文件路径
   */
  releaseLock(lockPath: string): void {
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch (error) {
      logger.warn('释放文件锁失败', { lockPath, error: String(error) });
    } finally {
      this.locks.delete(lockPath);
    }
  }

  /**
   * 原子写入文件（先写临时文件，再重命名）
   * @param filePath 目标文件路径
   * @param data 数据内容
   * @param useLock 是否使用文件锁
   */
  atomicWrite(
    filePath: string,
    data: string,
    useLock: boolean = true
  ): boolean {
    const lockPath = filePath + '.lock';
    const tempPath = filePath + '.tmp.' + process.pid + '.' + Date.now();

    if (useLock && !this.acquireLock(lockPath)) {
      return false;
    }

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(tempPath, data, 'utf-8');
      fs.renameSync(tempPath, filePath);
      return true;
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // 忽略清理错误
      }
      logger.error('原子写入失败', { filePath, error: String(error) });
      return false;
    } finally {
      if (useLock) {
        this.releaseLock(lockPath);
      }
    }
  }

  /**
   * 读取配置
   */
  readAll(options?: ConfigReadOptions): IOResult {
    const merged: Record<string, unknown> = options?.defaults
      ? { ...options.defaults }
      : {};

    for (const source of this.sources.sort((a, b) => b.priority - a.priority)) {
      if (source.exists) {
        try {
          const data = this.readFile(source.path, source.format);
          Object.assign(merged, data);
        } catch {}
      }
    }

    return { success: true, config: merged, sources: this.sources };
  }

  /**
   * 写入配置
   */
  write(
    config: Record<string, unknown>,
    scope: ConfigScope = 'local'
  ): IOResult {
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
        path: path.join(resolvePyappHome(), 'config.json'),
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
        path: path.join(resolveProjectRoot(), '.pyapp.local.json'),
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
  private readFile(
    filePath: string,
    format: ConfigFormat
  ): Record<string, unknown> {
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
  private writeFile(
    filePath: string,
    format: ConfigFormat,
    data: Record<string, unknown>
  ): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

export const configIO = new ConfigIO();
