/**
 * 配置热重载系统
 * 运行时监听配置变化并自动重载受影响模块
 * 对齐 OpenClaw config/config-reload.ts
 */

import { getLogger } from '../monitoring/logs/Logger.js';
import { handleError } from '@modules/error';
import { watch, type FSWatcher, readFileSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

const logger = getLogger('config:configReloader');

export interface ConfigChangeEvent {
  filePath: string;
  eventType: 'change' | 'rename';
  timestamp: number;
}

export interface ConfigReloadTarget {
  name: string;
  filePatterns: RegExp[];
  reload: () => Promise<void> | void;
  priority: number;
  /**
   * T2.3: 可选字段级对账钩子。返回 true = 有实质变化需 reload/rebuild；
   * false = 无实质变化跳过。未提供时用默认稳定 JSON 序列化比较。
   */
  diff?: (prev: unknown, next: unknown) => boolean;
  /**
   * T2.3: 可选重建钩子（身份/模块地址变化时重建 target）。
   * 提供后，有实质变化时优先调用 rebuild 而非 reload。
   */
  rebuild?: () => Promise<void> | void;
}

export class ConfigWatcher extends EventEmitter {
  private watchers: Map<string, FSWatcher> = new Map();
  private watchedDirs: string[] = [];
  private running = false;

  constructor(private debounceMs = 500) {
    super();
  }

  start(dirs: string[]): void {
    if (this.running) return;
    this.running = true;
    this.watchedDirs = dirs;

    for (const dir of dirs) {
      try {
        const watcher = watch(
          dir,
          { persistent: false },
          (_eventType, filename) => {
            if (!filename) return;
            const filePath = join(dir, filename);
            this.debounce(filePath);
          }
        );
        this.watchers.set(dir, watcher);
        logger.info(`配置监听已启动: ${dir}`);
      } catch (error) {
        logger.warning(`无法监听目录 ${dir}: ${(error as Error).message}`);
      }
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const [dir, watcher] of this.watchers) {
      watcher.close();
      logger.info(`配置监听已停止: ${dir}`);
    }
    this.watchers.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFiles: Set<string> = new Set();

  private debounce(filePath: string): void {
    this.pendingFiles.add(filePath);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const files = Array.from(this.pendingFiles);
      this.pendingFiles.clear();
      for (const file of files) {
        this.emit('change', {
          filePath: file,
          eventType: 'change',
          timestamp: Date.now(),
        } as ConfigChangeEvent);
      }
    }, this.debounceMs);
  }
}

export class ConfigReloader {
  private targets: ConfigReloadTarget[] = [];
  private watcher: ConfigWatcher;
  private lock = false;
  /** T2.3: target 上次稳定序列化内容（用于字段级对账） */
  private lastContents = new Map<string, string>();

  constructor(watcher?: ConfigWatcher) {
    this.watcher = watcher || new ConfigWatcher();
    this.watcher.on('change', (event: ConfigChangeEvent) => {
      this.handleChange(event).catch((err) => {
        void handleError(err, {
          module: 'config:reloader',
          action: '配置热重载失败',
        });
      });
    });
  }

  registerTarget(target: ConfigReloadTarget): void {
    this.targets.push(target);
    this.targets.sort((a, b) => a.priority - b.priority);
    logger.info(`注册热重载目标: ${target.name} (优先级: ${target.priority})`);
  }

  unregisterTarget(name: string): void {
    this.targets = this.targets.filter((t) => t.name !== name);
  }

  start(dirs: string[]): void {
    this.watcher.start(dirs);
  }

  stop(): void {
    this.watcher.stop();
  }

  private async handleChange(event: ConfigChangeEvent): Promise<void> {
    if (this.lock) {
      logger.debug('配置重载进行中，跳过此次变更');
      return;
    }

    this.lock = true;
    try {
      const matchedTargets = this.targets.filter((t) =>
        t.filePatterns.some((p) => p.test(event.filePath))
      );

      if (matchedTargets.length === 0) {
        logger.debug(`配置变更未匹配任何重载目标: ${event.filePath}`);
        return;
      }

      logger.info(
        `配置变更: ${event.filePath}, 重载 ${matchedTargets.length} 个目标`
      );
      for (const target of matchedTargets) {
        try {
          // T2.3: 字段级对账 —— 无实质变化时跳过 reload（值未变不重载）
          if (await this.shouldSkipReload(target, event.filePath)) {
            logger.info(`配置无实质变化，跳过重载: ${target.name}`);
            continue;
          }

          // 身份/模块地址类 target 提供 rebuild → 优先重建（最小破坏性）
          if (target.rebuild) {
            await target.rebuild();
            logger.info(`重建完成: ${target.name}`);
          } else {
            await target.reload();
            logger.info(`重载完成: ${target.name}`);
          }
        } catch (error) {
          void handleError(error, {
            module: 'config:reloader',
            action: `重载失败: ${target.name}`,
          });
        }
      }
    } finally {
      this.lock = false;
    }
  }

  /**
   * T2.3: 判断目标是否应跳过 reload。
   * 用稳定 JSON 序列化比较（处理数组/嵌套结构），target.diff 覆盖钩子优先。
   * 保守策略：diff 不存在、序列化失败或无法判定 → 一律 reload（不跳过）。
   */
  private async shouldSkipReload(
    target: ConfigReloadTarget,
    filePath: string
  ): Promise<boolean> {
    // 无 diff 能力（未提供 diff 且读取失败）→ 保守 reload
    let next: unknown;
    try {
      const content = readFileSync(filePath, 'utf-8');
      next = JSON.parse(content);
    } catch {
      // 读取/解析失败 → 无法判定 → reload（保守）
      this.lastContents.delete(target.name);
      return false;
    }

    const prevSerialized = this.lastContents.get(target.name);
    const nextSerialized = stableSerialize(next);

    if (prevSerialized === undefined) {
      // 首次变更：记录基线，触发 reload
      this.lastContents.set(target.name, nextSerialized);
      return false;
    }

    // 覆盖钩子优先
    if (target.diff) {
      let prev: unknown;
      try {
        prev = JSON.parse(prevSerialized);
      } catch {
        this.lastContents.set(target.name, nextSerialized);
        return false; // 无法解析上次内容 → reload（保守）
      }
      const changed = target.diff(prev, next);
      this.lastContents.set(target.name, nextSerialized);
      return !changed;
    }

    // 默认：稳定序列化比较（key 排序后比较，数组顺序变化视为实质变化 → reload）
    this.lastContents.set(target.name, nextSerialized);
    return prevSerialized === nextSerialized;
  }
}

/**
 * 稳定 JSON 序列化：递归排序对象 key（处理数组/嵌套结构），
 * 避免浅比较对通道数组配置误判。数组元素顺序保留（顺序变化 = 实质变化）。
 */
export function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`
    );
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createConfigWatcher(dirs: string[]): ConfigWatcher {
  const watcher = new ConfigWatcher();
  watcher.start(dirs);
  return watcher;
}

export function createConfigReloader(watcher?: ConfigWatcher): ConfigReloader {
  return new ConfigReloader(watcher);
}
