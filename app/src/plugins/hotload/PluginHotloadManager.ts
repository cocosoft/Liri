/**
 * 插件热加载管理器
 * 监听插件目录文件变更，自动触发插件的卸载→加载→激活流水线
 * 支持状态备份和回滚，重载失败时恢复旧状态
 *
 * 增强功能（阶段3）：
 * - 模块级依赖图：热加载时的卸载排序（先卸载依赖方，后卸载被依赖方）
 * - ActivationContext 持久化：重载前后保存/恢复插件上下文
 * - 优雅卸载：依次执行 deactivate → saveContext → unload
 */

import { resolveProjectRoot } from '@modules/core/paths';
import { configManager } from '@modules/config';
import {
  watch,
  FSWatcher,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'fs';
import { resolve, extname, basename, dirname } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { PluginState } from '../types/PluginTypes';
import { PluginManager } from '../managers/PluginManager';
const pluginManager = PluginManager.getInstance();
import {
  ActivationContextManager,
  type ActivationContext,
} from '../lifecycle/ActivationContext';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 插件热加载事件类型
 */
export enum PluginHotloadEvent {
  ADDED = 'added',
  MODIFIED = 'modified',
  REMOVED = 'removed',
  BEFORE_HOTLOAD = 'beforeHotload',
  AFTER_HOTLOAD = 'afterHotload',
}

/**
 * 插件热加载事件
 */
export interface PluginHotloadEventData {
  type: PluginHotloadEvent;
  pluginName: string;
  pluginPath: string;
  timestamp: number;
}

/**
 * 插件热加载监听器
 */
export type PluginHotloadListener = (
  event: PluginHotloadEventData
) => void | Promise<void>;

/**
 * 热部署状态枚举
 */
export enum HotloadStatus {
  IN_PROGRESS = 'in_progress',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * 热部署历史记录
 */
export interface HotloadRecord {
  pluginName: string;
  status: HotloadStatus;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  error?: string;
  dependents?: string[];
}

/**
 * 插件热加载配置
 */
export interface HotloadConfig {
  enabled: boolean;
  debounceMs: number;
  watchSubdirectories: boolean;
  /** 监听的扩展名列表，空数组表示监听所有文件 */
  watchExtensions: string[];
  /** 是否自动重载（变化时自动触发 reload 流水线） */
  autoReload: boolean;
  /** 状态持久化目录（空字符串表示不持久化） */
  statePersistenceDir: string;
  /** 额外监听目录列表（支持多目录发现插件） */
  watchDirs: string[];
}

/** 默认监听的插件文件扩展名 */
const DEFAULT_WATCH_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.json'];

const DEFAULT_HOTLOAD_CONFIG: HotloadConfig = {
  enabled: true,
  debounceMs: 500,
  watchSubdirectories: true,
  watchExtensions: DEFAULT_WATCH_EXTENSIONS,
  autoReload: true,
  statePersistenceDir: '',
  watchDirs: [],
};

/**
 * 插件状态快照，用于重载失败时回滚
 */
interface PluginStateSnapshot {
  state: PluginState;
  instance: unknown | undefined;
  error: string | undefined;
  /** 持久化的激活上下文 */
  activationContext: ActivationContext | null;
}

/**
 * 插件热加载管理器
 */
export class PluginHotloadManager {
  private watchers: FSWatcher[] = [];
  private listeners: Set<PluginHotloadListener> = new Set();
  private config: HotloadConfig;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  /** 已知插件路径映射：pluginName → 插件目录绝对路径 */
  private pluginPaths: Map<string, string> = new Map();
  /** 状态备份：重载前保存，失败时回滚 */
  private stateBackup: Map<string, PluginStateSnapshot> = new Map();
  /** 模块级依赖图：pluginName → 依赖方（依赖该插件的插件列表） */
  private _dependencyGraph: Map<string, Set<string>> = new Map();
  /** 激活上下文管理器 */
  private _activationContextManager: ActivationContextManager;
  /** 热部署历史记录 */
  private _hotloadHistory: HotloadRecord[] = [];
  /** 最大历史记录数 */
  private _maxHistorySize = 100;

  constructor(config: Partial<HotloadConfig> = {}) {
    this.config = { ...DEFAULT_HOTLOAD_CONFIG, ...config };
    this._activationContextManager = new ActivationContextManager();
  }

  /**
   * 记录热部署历史
   */
  private _addHotloadRecord(record: HotloadRecord): void {
    this._hotloadHistory.push(record);
    if (this._hotloadHistory.length > this._maxHistorySize) {
      this._hotloadHistory.shift();
    }
  }

  /**
   * 初始化热加载管理器
   * @param pluginManager 插件管理器
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Hotload disabled by config');
      return;
    }

    await this.startWatching();
  }

  /**
   * 启动文件监听（每目录创建独立 watcher）
   */
  private async startWatching(): Promise<void> {
    const directories = this.getWatchDirectories();
    if (directories.length === 0) {
      logger.warning('No plugin directories found, hotload disabled');
      return;
    }

    for (const dir of directories) {
      try {
        const w = watch(
          dir,
          { recursive: this.config.watchSubdirectories },
          (eventType, filename) => {
            if (filename) {
              this.handleFileChange(eventType, filename);
            }
          }
        );

        w.on('error', (error) => {
          logger.error(`Hotload watcher error for ${dir}:`, { error });
        });

        this.watchers.push(w);
        logger.debug(`Watcher started for: ${dir}`);
      } catch (error) {
        logger.error(`Failed to start watcher for ${dir}:`, { error });
      }
    }

    logger.info(`Hotload enabled, watching ${this.watchers.length} dirs`);
  }

  /**
   * 获取所有监听目录
   */
  private getWatchDirectories(): string[] {
    const dirs: string[] = [];

    const defaultDir = this.getPluginDirectory();
    if (defaultDir) {
      dirs.push(defaultDir);
    }

    for (const extraDir of this.config.watchDirs) {
      if (!dirs.includes(extraDir)) {
        dirs.push(extraDir);
      }
    }

    return dirs;
  }

  /**
   * 添加监听目录（需要 restartWatching 生效）
   * @param dir 目录路径
   */
  addWatchDir(dir: string): void {
    if (!this.config.watchDirs.includes(dir)) {
      this.config.watchDirs.push(dir);
      logger.info(`Added watch directory: ${dir}`);
    }
  }

  /**
   * 移除监听目录（需要 restartWatching 生效）
   * @param dir 目录路径
   */
  removeWatchDir(dir: string): void {
    this.config.watchDirs = this.config.watchDirs.filter((d) => d !== dir);
    logger.info(`Removed watch directory: ${dir}`);
  }

  /**
   * 重启监听器（添加/移除目录后调用）
   */
  async restartWatching(): Promise<void> {
    this.stop();
    await this.startWatching();
  }

  /**
   * 处理文件变化
   * @param eventType 事件类型：'rename'（新建/删除）或 'change'（修改）
   * @param filename 相对路径文件名
   */
  private handleFileChange(eventType: string, filename: string): void {
    const pluginDir = this.getPluginDirectory();
    if (!pluginDir) return;

    const fullPath = resolve(pluginDir, filename);
    const ext = extname(filename).toLowerCase();

    // 按扩展名过滤
    const exts = this.config.watchExtensions;
    if (exts.length > 0 && !exts.includes(ext)) {
      return;
    }

    const pluginName = this.extractPluginName(filename);
    if (!pluginName) return;

    // 正确映射事件类型：rename 需要检查文件是否存在来区分 ADDED/REMOVED
    let mappedType: PluginHotloadEvent;
    if (eventType === 'rename') {
      mappedType = existsSync(fullPath)
        ? PluginHotloadEvent.ADDED
        : PluginHotloadEvent.REMOVED;
    } else {
      mappedType = PluginHotloadEvent.MODIFIED;
    }

    const event: PluginHotloadEventData = {
      type: mappedType,
      pluginName,
      pluginPath: fullPath,
      timestamp: Date.now(),
    };

    this.debounce(pluginName, () => {
      this.processEvent(event);
    });
  }

  /**
   * 处理已防抖的事件：通知监听器 + 自动重载
   */
  private async processEvent(event: PluginHotloadEventData): Promise<void> {
    // 1. 通知外部监听器
    await this.notifyListeners(event);

    // 2. 按事件类型执行自动操作
    switch (event.type) {
      case PluginHotloadEvent.MODIFIED:
        if (this.config.autoReload && this.pluginPaths.has(event.pluginName)) {
          await this.reloadPlugin(event.pluginName);
        }
        break;
      case PluginHotloadEvent.ADDED:
        this.pluginPaths.set(
          event.pluginName,
          this.getPluginDirFromPath(event.pluginPath)
        );
        break;
      case PluginHotloadEvent.REMOVED:
        this.pluginPaths.delete(event.pluginName);
        break;
    }
  }

  /**
   * 防抖处理
   * @param key 键
   * @param callback 回调
   */
  private debounce(key: string, callback: () => void): void {
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      callback();
    }, this.config.debounceMs);

    this.debounceTimers.set(key, timer);
  }

  /**
   * 从文件相对路径中提取插件名称（首段目录名）
   * @param filename 相对路径，如 "my-plugin/index.js"
   * @returns 插件名称，如 "my-plugin"
   */
  private extractPluginName(filename: string): string | null {
    const parts = filename.split(/[/\\]/);
    if (parts.length >= 1 && parts[0].length > 0) {
      return parts[0];
    }
    return null;
  }

  /**
   * 从文件路径获取插件目录路径
   */
  private getPluginDirFromPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    const pluginDir = this.getPluginDirectory() || '';
    // 如果文件路径包含插件名子目录，返回插件根目录
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === basename(pluginDir)) {
        return parts.slice(0, i + 1).join('/');
      }
    }
    return filePath;
  }

  /**
   * 获取插件目录
   * @returns 插件目录绝对路径
   */
  private getPluginDirectory(): string | null {
    const envDir = configManager.env('PLUGIN_DIR');
    if (envDir) {
      return resolve(envDir);
    }
    return resolve(resolveProjectRoot(), 'plugins');
  }

  /**
   * 通知监听器
   * @param event 事件数据
   */
  private async notifyListeners(event: PluginHotloadEventData): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        logger.error('Hotload listener error:', { error });
      }
    }
  }

  /**
   * 注册监听器
   * @param listener 监听器函数
   */
  addListener(listener: PluginHotloadListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除监听器
   * @param listener 监听器函数
   */
  removeListener(listener: PluginHotloadListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 跟踪插件路径（供 PluginManager 加载完成后调用）
   * @param pluginName 插件名称
   * @param pluginDir 插件目录
   */
  trackPluginPath(pluginName: string, pluginDir: string): void {
    this.pluginPaths.set(pluginName, pluginDir);
    logger.info(`Tracking plugin path: ${pluginName} → ${pluginDir}`);
  }

  /**
   * 停止跟踪插件路径
   * @param pluginName 插件名称
   */
  untrackPluginPath(pluginName: string): void {
    this.pluginPaths.delete(pluginName);
  }

  /**
   * 重新加载插件：停用→备份状态→卸载→加载→激活
   * 任何步骤失败则回滚到备份状态
   * @param pluginName 插件名称
   */
  async reloadPlugin(pluginName: string): Promise<void> {
    // 1. 检查插件当前是否存在
    if (!pluginManager.hasPlugin(pluginName)) {
      logger.warning(`Cannot reload unknown plugin: ${pluginName}`);
      return;
    }

    // 2. 备份当前状态用于回滚
    const currentPlugin = pluginManager.getPlugin(pluginName);
    if (currentPlugin) {
      this.stateBackup.set(pluginName, {
        state: currentPlugin.state,
        instance: currentPlugin.instance,
        error: currentPlugin.error,
        activationContext:
          this._activationContextManager.get(pluginName) || null,
      });
    }

    const reloadLog = { pluginName, startedAt: Date.now() };

    try {
      // 3. 执行 reload（内部处理停用→卸载→加载→激活）
      await pluginManager.reloadPlugin(pluginName);

      // 清除备份（重载成功）
      this.stateBackup.delete(pluginName);

      logger.info(`✅ Plugin hot-reloaded successfully: ${pluginName}`, {
        durationMs: Date.now() - reloadLog.startedAt,
      });
    } catch (error) {
      // 4. 回滚：恢复备份状态
      await this.rollbackPlugin(pluginName);

      logger.error(`❌ Plugin hot-reload failed, rolled back: ${pluginName}`, {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - reloadLog.startedAt,
      });
    }
  }

  /**
   * 回滚插件到重载前的状态
   * @param pluginName 插件名称
   */
  private async rollbackPlugin(pluginName: string): Promise<void> {
    const snapshot = this.stateBackup.get(pluginName);
    if (!snapshot) {
      logger.warning(`No backup state found for rollback: ${pluginName}`);
      return;
    }

    try {
      // 检查插件是否还在，不在则尝试重新加载
      if (!pluginManager.hasPlugin(pluginName)) {
        await pluginManager.loadPlugin(pluginName);
      }

      // 如果旧状态是激活的，重新激活
      if (snapshot.state === 'activated' || snapshot.state === 'enabled') {
        pluginManager.enablePlugin(pluginName);
      }

      logger.info(`Plugin rolled back: ${pluginName}`);
    } catch (rollbackError) {
      logger.error(`Rollback failed for plugin ${pluginName}:`, {
        error:
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
      });
    } finally {
      this.stateBackup.delete(pluginName);
    }
  }

  /**
   * 获取当前跟踪的插件列表
   * @returns 插件名称数组
   */
  getTrackedPlugins(): string[] {
    return Array.from(this.pluginPaths.keys());
  }

  /**
   * 检查插件是否正在被跟踪
   * @param pluginName 插件名称
   */
  isTracking(pluginName: string): boolean {
    return this.pluginPaths.has(pluginName);
  }

  /**
   * 停止监听
   */
  stop(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pluginPaths.clear();
    this.stateBackup.clear();
    this.listeners.clear();
    this._dependencyGraph.clear();

    logger.info('Hotload watcher stopped');
  }

  /**
   * 获取配置
   * @returns 热加载配置副本
   */
  getConfig(): HotloadConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   * @param config 部分配置
   */
  updateConfig(config: Partial<HotloadConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ==================== 阶段3 增强功能 ====================

  /**
   * 构建模块级依赖图
   * @param dependencies 插件依赖映射：pluginName → [depName, ...]
   */
  buildDependencyGraph(dependencies: Record<string, string[]>): void {
    this._dependencyGraph.clear();

    for (const [pluginName, deps] of Object.entries(dependencies)) {
      if (!this._dependencyGraph.has(pluginName)) {
        this._dependencyGraph.set(pluginName, new Set());
      }
      for (const dep of deps) {
        if (!this._dependencyGraph.has(dep)) {
          this._dependencyGraph.set(dep, new Set());
        }
        this._dependencyGraph.get(dep)!.add(pluginName);
      }
    }

    logger.info('Dependency graph built', {
      nodes: this._dependencyGraph.size,
    });
  }

  /**
   * 添加单条依赖关系
   * @param pluginName 依赖方
   * @param dependsOn 被依赖方
   */
  addDependency(pluginName: string, dependsOn: string): void {
    if (!this._dependencyGraph.has(dependsOn)) {
      this._dependencyGraph.set(dependsOn, new Set());
    }
    this._dependencyGraph.get(dependsOn)!.add(pluginName);
  }

  /**
   * 移除插件的依赖关系
   * @param pluginName 要移除的插件
   */
  removeDependency(pluginName: string): void {
    this._dependencyGraph.delete(pluginName);
    for (const dependents of this._dependencyGraph.values()) {
      dependents.delete(pluginName);
    }
  }

  /**
   * 获取卸载顺序（拓扑排序）
   * 先卸载依赖方，后卸载被依赖方
   * @param pluginName 目标插件
   * @returns 卸载顺序数组（含目标插件自身）
   */
  getUnloadOrder(pluginName: string): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const dfs = (name: string): void => {
      if (visited.has(name)) return;
      visited.add(name);

      const dependents = this._dependencyGraph.get(name);
      if (dependents) {
        for (const dep of dependents) {
          dfs(dep);
        }
      }

      order.push(name);
    };

    dfs(pluginName);

    return order;
  }

  /**
   * 持久化激活上下文到磁盘
   * @param pluginName 插件名称
   */
  savePluginState(pluginName: string): void {
    const ctx = this._activationContextManager.get(pluginName);
    if (!ctx) return;

    const persistDir = this.config.statePersistenceDir;
    if (!persistDir) return;

    const pluginDir = resolve(persistDir, pluginName);
    if (!existsSync(pluginDir)) {
      mkdirSync(pluginDir, { recursive: true });
    }

    const statePath = resolve(pluginDir, 'activation-context.json');
    writeFileSync(statePath, JSON.stringify(ctx, null, 2), 'utf8');

    logger.debug(`Plugin state saved: ${pluginName}`, { path: statePath });
  }

  /**
   * 从磁盘恢复激活上下文
   * @param pluginName 插件名称
   * @returns 激活上下文或 null
   */
  restorePluginState(pluginName: string): ActivationContext | null {
    const persistDir = this.config.statePersistenceDir;
    if (!persistDir) return null;

    const statePath = resolve(
      persistDir,
      pluginName,
      'activation-context.json'
    );
    if (!existsSync(statePath)) return null;

    try {
      const raw = readFileSync(statePath, 'utf8');
      const ctx = JSON.parse(raw) as ActivationContext;
      return ctx;
    } catch (error) {
      logger.error(`Failed to restore plugin state: ${pluginName}`, { error });
      return null;
    }
  }

  /**
   * 优雅卸载插件：按依赖图顺序卸载依赖方 → 被依赖方
   * 先通过 getUnloadOrder() 获取拓扑排序的卸载顺序，
   * 确保依赖方先于被依赖方卸载。如依赖图无目标节点则直接卸载。
   * @param pluginName 插件名称
   */
  async gracefulUnload(pluginName: string): Promise<void> {
    logger.info(`Graceful unload starting: ${pluginName}`);

    const unloadOrder = this.getUnloadOrder(pluginName);

    if (unloadOrder.length > 1) {
      logger.info(`Unload order for ${pluginName}: ${unloadOrder.join(' → ')}`);
    }

    for (const name of unloadOrder) {
      if (!pluginManager.hasPlugin(name)) {
        logger.debug(`Skipping unload (not loaded): ${name}`);
        continue;
      }

      // 1. 停用插件并记录上下文
      this._activationContextManager.create(name, 'reload', {
        previousState: pluginManager.getPlugin(name)?.state,
      });

      try {
        await pluginManager.disablePlugin(name);
        logger.debug(`Plugin deactivated: ${name}`);
      } catch (error) {
        logger.error(`Deactivate failed during graceful unload: ${name}`, {
          error,
        });
        throw error;
      }

      // 2. 持久化上下文
      this.savePluginState(name);

      // 3. 卸载插件
      await pluginManager.uninstallPlugin(name);
      logger.debug(`Graceful unload complete: ${name}`);
    }

    logger.info(
      `Graceful unload complete for all dependents of: ${pluginName}`
    );
  }

  /**
   * 手动触发单个插件热部署
   * 检查插件是否存在且可重载，然后执行依赖感知的重载流程
   * 触发前后发射 BEFORE_HOTLOAD / AFTER_HOTLOAD 事件，并记录历史
   * @param pluginName 插件名称
   */
  async triggerHotload(pluginName: string): Promise<boolean> {
    if (!this.pluginPaths.has(pluginName)) {
      const record: HotloadRecord = {
        pluginName,
        status: HotloadStatus.FAILED,
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 0,
        error: 'Unknown plugin',
      };
      this._addHotloadRecord(record);

      logger.warning(`Cannot trigger hotload: unknown plugin ${pluginName}`);
      return false;
    }

    const startedAt = Date.now();
    const unloadOrder = this.getUnloadOrder(pluginName);
    const dependents = unloadOrder.filter((n) => n !== pluginName);

    // 发射 BEFORE_HOTLOAD 事件
    await this.notifyListeners({
      type: PluginHotloadEvent.BEFORE_HOTLOAD,
      pluginName,
      pluginPath: this.pluginPaths.get(pluginName) || '',
      timestamp: startedAt,
    });

    try {
      await this.reloadPluginWithDeps(pluginName);

      const completedAt = Date.now();
      this._addHotloadRecord({
        pluginName,
        status: HotloadStatus.SUCCESS,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        dependents: dependents.length > 0 ? dependents : undefined,
      });

      // 发射 AFTER_HOTLOAD 事件
      await this.notifyListeners({
        type: PluginHotloadEvent.AFTER_HOTLOAD,
        pluginName,
        pluginPath: this.pluginPaths.get(pluginName) || '',
        timestamp: completedAt,
      });

      logger.info(`✅ Manual hotload succeeded: ${pluginName}`);
      return true;
    } catch (error) {
      const completedAt = Date.now();
      const errMsg = error instanceof Error ? error.message : String(error);

      this._addHotloadRecord({
        pluginName,
        status: HotloadStatus.FAILED,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        error: errMsg,
        dependents: dependents.length > 0 ? dependents : undefined,
      });

      // 发射 AFTER_HOTLOAD 事件（即使失败也通知）
      await this.notifyListeners({
        type: PluginHotloadEvent.AFTER_HOTLOAD,
        pluginName,
        pluginPath: this.pluginPaths.get(pluginName) || '',
        timestamp: completedAt,
      });

      logger.error(`Manual hotload failed: ${pluginName}`, {
        error: errMsg,
      });
      return false;
    }
  }

  /**
   * 批量手动触发热部署
   * 按依赖图顺序逐个执行热部署，一个失败不影响后续
   * @param pluginNames 插件名称列表
   * @returns 成功与失败的插件列表
   */
  async triggerBatchHotload(pluginNames: string[]): Promise<{
    succeeded: string[];
    failed: { name: string; error: string }[];
  }> {
    const result: {
      succeeded: string[];
      failed: { name: string; error: string }[];
    } = {
      succeeded: [],
      failed: [],
    };

    for (const name of pluginNames) {
      try {
        const ok = await this.triggerHotload(name);
        if (ok) {
          result.succeeded.push(name);
        } else {
          result.failed.push({
            name,
            error: 'Plugin not tracked or reload failed',
          });
        }
      } catch (error) {
        result.failed.push({
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * 获取热部署历史记录
   * @param limit 最大返回条数（默认全部，0 表示全部）
   * @returns 历史记录列表（按时间倒序）
   */
  getHotloadHistory(limit = 0): HotloadRecord[] {
    const history = [...this._hotloadHistory].reverse();
    return limit > 0 ? history.slice(0, limit) : history;
  }

  /**
   * 清除热部署历史记录
   */
  clearHotloadHistory(): void {
    this._hotloadHistory = [];
    logger.info('Hotload history cleared');
  }

  /**
   * 带依赖顺序的重新加载
   * 根据依赖图先卸载依赖方，再卸载目标插件
   * 重载成功后按逆序重新加载
   * @param pluginName 目标插件名称
   */
  async reloadPluginWithDeps(pluginName: string): Promise<void> {
    const unloadOrder = this.getUnloadOrder(pluginName);
    logger.info(`Reload with deps: ${pluginName}`, { unloadOrder });

    // 备份所有受影响插件的状态
    for (const name of unloadOrder) {
      if (pluginManager.hasPlugin(name)) {
        const currentPlugin = pluginManager.getPlugin(name);
        if (currentPlugin) {
          this.stateBackup.set(name, {
            state: currentPlugin.state,
            instance: currentPlugin.instance,
            error: currentPlugin.error,
            activationContext: this._activationContextManager.get(name) || null,
          });
        }
      }
    }

    try {
      // 按顺序优雅卸载（依赖方先卸载）
      for (const name of unloadOrder) {
        if (pluginManager.hasPlugin(name)) {
          await this.gracefulUnload(name);
        }
      }

      // 逆序重新加载（被依赖方先加载）
      const reloadOrder = [...unloadOrder].reverse();
      for (const name of reloadOrder) {
        if (this.stateBackup.has(name)) {
          await pluginManager.loadPlugin(name);
        }
      }

      // 清除备份
      for (const name of unloadOrder) {
        this.stateBackup.delete(name);
      }

      logger.info(`✅ Reload with deps succeeded: ${pluginName}`);
    } catch (error) {
      // 回滚
      for (const name of unloadOrder) {
        await this.rollbackPlugin(name);
      }

      logger.error(`❌ Reload with deps failed, rolled back: ${pluginName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 获取依赖图快照
   * @returns 依赖图副本
   */
  getDependencyGraph(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [key, deps] of this._dependencyGraph) {
      result.set(key, Array.from(deps));
    }
    return result;
  }

  /**
   * 获取激活上下文管理器
   */
  getActivationContextManager(): ActivationContextManager {
    return this._activationContextManager;
  }
}

/**
 * 热加载管理器单例
 */
let hotloadManagerInstance: PluginHotloadManager | null = null;

/**
 * 获取热加载管理器单例
 */
export function getHotloadManager(): PluginHotloadManager {
  if (!hotloadManagerInstance) {
    hotloadManagerInstance = new PluginHotloadManager();
  }
  return hotloadManagerInstance;
}

/**
 * 重置热加载管理器单例（仅测试用）
 */
export function resetHotloadManager(): void {
  if (hotloadManagerInstance) {
    hotloadManagerInstance.stop();
    hotloadManagerInstance = null;
  }
}
