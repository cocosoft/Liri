/**
 * 负责管理插件的完整生命周期和状态转换
 */

import { EventEmitter } from 'events';
import { getLogger } from '@modules/monitoring';
import {
  PluginState,
  LoadedPlugin,
  PluginEventType,
  PluginEvent,
} from '../types/PluginTypes';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('plugins:core:pluginLifecycleManager');

/**
 * 生命周期事件类型
 */
export enum PluginLifecycleEvent {
  /** 初始化前 */
  BEFORE_INITIALIZE = 'beforeInitialize',

  /** 初始化后 */
  AFTER_INITIALIZE = 'afterInitialize',

  /** 启动前 */
  BEFORE_START = 'beforeStart',

  /** 启动后 */
  AFTER_START = 'afterStart',

  /** 停止前 */
  BEFORE_STOP = 'beforeStop',

  /** 停止后 */
  AFTER_STOP = 'afterStop',

  /** 卸载前 */
  BEFORE_UNLOAD = 'beforeUnload',

  /** 卸载后 */
  AFTER_UNLOAD = 'afterUnload',

  /** 错误事件 */
  ERROR = 'error',

  /** 状态变化 */
  STATUS_CHANGED = 'statusChanged',
}

/**
 * 生命周期钩子
 */
export interface LifecycleHook {
  /** 钩子名称 */
  name: string;

  /** 钩子处理器 */
  handler: (plugin: LoadedPlugin) => Promise<void> | void;

  /** 优先级 */
  priority?: number;
}

/**
 * 生命周期上下文
 */
export interface LifecycleContext {
  /** 插件 */
  plugin: LoadedPlugin;

  /** 时间戳 */
  timestamp: Date;

  /** 错误信息 */
  error?: Error;
}

/**
 * 插件生命周期管理器
 */
export class PluginLifecycleManager extends EventEmitter {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private lifecycleHooks: Map<PluginLifecycleEvent, LifecycleHook[]> =
    new Map();
  private isRunning = false;

  /**
   * 构造函数
   */
  constructor() {
    super();

    // 初始化生命周期钩子映射
    Object.values(PluginLifecycleEvent).forEach((event) => {
      this.lifecycleHooks.set(event, []);
    });
  }

  /**
   * 注册插件
   */
  registerPlugin(plugin: LoadedPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new AppError(
        `Plugin already registered: ${plugin.id}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.plugins.set(plugin.id, plugin);

    this.emitLifecycleEvent(PluginLifecycleEvent.AFTER_INITIALIZE, plugin);

    logger.info(`✅ Plugin registered: ${plugin.id}`);
  }

  /**
   * 注销插件
   */
  unregisterPlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      return false;
    }

    // 如果插件正在运行，先停止
    if (plugin.state === PluginState.ACTIVATED) {
      this.stopPlugin(pluginId);
    }

    this.plugins.delete(pluginId);

    this.emitLifecycleEvent(PluginLifecycleEvent.AFTER_UNLOAD, plugin);

    logger.info(`✅ Plugin unregistered: ${pluginId}`);

    return true;
  }

  /**
   * 启动插件
   */
  async startPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      throw new AppError(
        `Plugin not found: ${pluginId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (plugin.state === PluginState.ACTIVATED) {
      return; // 已经启动
    }

    if (plugin.state !== PluginState.LOADED) {
      throw new AppError(
        `Plugin must be loaded before starting, current state: ${plugin.state}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    try {
      // 执行启动前钩子
      await this.executeLifecycleHooks(
        PluginLifecycleEvent.BEFORE_START,
        plugin
      );

      // 更新插件状态
      plugin.state = PluginState.ACTIVATED;
      plugin.activatedAt = new Date();
      if (plugin.stats) plugin.stats.activateCount++;

      // 执行启动后钩子
      await this.executeLifecycleHooks(
        PluginLifecycleEvent.AFTER_START,
        plugin
      );

      this.emitLifecycleEvent(PluginLifecycleEvent.STATUS_CHANGED, plugin, {
        oldState: PluginState.LOADED,
        newState: PluginState.ACTIVATED,
      });

      logger.info(`✅ Plugin started: ${pluginId}`);
    } catch (error) {
      plugin.state = PluginState.FAILED;
      plugin.error = error instanceof Error ? error.message : String(error);
      if (plugin.stats) plugin.stats.errorCount++;

      this.emitLifecycleEvent(PluginLifecycleEvent.ERROR, plugin, { error });

      throw error;
    }
  }

  /**
   * 停止插件
   */
  async stopPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      throw new AppError(
        `Plugin not found: ${pluginId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (plugin.state !== PluginState.ACTIVATED) {
      return; // 已经停止
    }

    try {
      // 执行停止前钩子
      await this.executeLifecycleHooks(
        PluginLifecycleEvent.BEFORE_STOP,
        plugin
      );

      // 更新插件状态
      plugin.state = PluginState.DEACTIVATED;
      plugin.deactivatedAt = new Date();

      // 执行停止后钩子
      await this.executeLifecycleHooks(PluginLifecycleEvent.AFTER_STOP, plugin);

      this.emitLifecycleEvent(PluginLifecycleEvent.STATUS_CHANGED, plugin, {
        oldState: PluginState.ACTIVATED,
        newState: PluginState.DEACTIVATED,
      });

      logger.info(`✅ Plugin stopped: ${pluginId}`);
    } catch (error) {
      plugin.state = PluginState.FAILED;
      plugin.error = error instanceof Error ? error.message : String(error);
      if (plugin.stats) plugin.stats.errorCount++;

      this.emitLifecycleEvent(PluginLifecycleEvent.ERROR, plugin, { error });

      throw error;
    }
  }

  /**
   * 重新启动插件
   */
  async restartPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      throw new AppError(
        `Plugin not found: ${pluginId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (plugin.state === PluginState.ACTIVATED) {
      await this.stopPlugin(pluginId);
    }

    await this.startPlugin(pluginId);

    logger.info(`✅ Plugin restarted: ${pluginId}`);
  }

  /**
   * 启动所有插件
   */
  async startAllPlugins(): Promise<void> {
    this.emitLifecycleEvent(PluginLifecycleEvent.BEFORE_START, null);

    for (const plugin of this.plugins.values()) {
      if (plugin.state === PluginState.LOADED) {
        try {
          await this.startPlugin(plugin.id);
        } catch (error) {
          logger.error(`Failed to start plugin ${plugin.id}:`, { error });
        }
      }
    }

    this.emitLifecycleEvent(PluginLifecycleEvent.AFTER_START, null);

    logger.info(
      `✅ All plugins started: ${this.getActivatedPlugins().length}/${this.plugins.size}`
    );
  }

  /**
   * 停止所有插件
   */
  async stopAllPlugins(): Promise<void> {
    this.emitLifecycleEvent(PluginLifecycleEvent.BEFORE_STOP, null);

    for (const plugin of this.plugins.values()) {
      if (plugin.state === PluginState.ACTIVATED) {
        try {
          await this.stopPlugin(plugin.id);
        } catch (error) {
          logger.error(`Failed to stop plugin ${plugin.id}:`, { error });
        }
      }
    }

    this.emitLifecycleEvent(PluginLifecycleEvent.AFTER_STOP, null);

    logger.info(
      `✅ All plugins stopped: ${this.getDeactivatedPlugins().length}/${this.plugins.size}`
    );
  }

  /**
   * 注册生命周期钩子
   */
  registerLifecycleHook(
    event: PluginLifecycleEvent,
    hook: LifecycleHook
  ): void {
    const hooks = this.lifecycleHooks.get(event) || [];

    // 按优先级排序
    hooks.push(hook);
    hooks.sort((a, b) => (a.priority || 0) - (b.priority || 0));

    this.lifecycleHooks.set(event, hooks);

    logger.info(`✅ Lifecycle hook registered: ${hook.name} for ${event}`);
  }

  /**
   * 注销生命周期钩子
   */
  unregisterLifecycleHook(
    event: PluginLifecycleEvent,
    hookName: string
  ): boolean {
    const hooks = this.lifecycleHooks.get(event) || [];
    const index = hooks.findIndex((hook) => hook.name === hookName);

    if (index === -1) {
      return false;
    }

    hooks.splice(index, 1);
    this.lifecycleHooks.set(event, hooks);

    logger.info(`✅ Lifecycle hook unregistered: ${hookName} from ${event}`);

    return true;
  }

  /**
   * 执行生命周期钩子
   */
  private async executeLifecycleHooks(
    event: PluginLifecycleEvent,
    plugin: LoadedPlugin
  ): Promise<void> {
    const hooks = this.lifecycleHooks.get(event) || [];

    for (const hook of hooks) {
      try {
        await hook.handler(plugin);
      } catch (error) {
        logger.error(
          `Lifecycle hook ${hook.name} failed for plugin ${plugin.id}:`,
          { error }
        );

        this.emitLifecycleEvent(PluginLifecycleEvent.ERROR, plugin, {
          error,
          hookName: hook.name,
        });
      }
    }
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取已激活插件
   */
  getActivatedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.state === PluginState.ACTIVATED
    );
  }

  /**
   * 获取已停用插件
   */
  getDeactivatedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.state === PluginState.DEACTIVATED
    );
  }

  /**
   * 获取失败插件
   */
  getFailedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.state === PluginState.FAILED
    );
  }

  /**
   * 获取插件状态统计
   */
  getPluginStats(): {
    total: number;
    activated: number;
    deactivated: number;
    failed: number;
    loading: number;
    unloaded: number;
  } {
    const plugins = Array.from(this.plugins.values());

    return {
      total: plugins.length,
      activated: plugins.filter((p) => p.state === PluginState.ACTIVATED)
        .length,
      deactivated: plugins.filter((p) => p.state === PluginState.DEACTIVATED)
        .length,
      failed: plugins.filter((p) => p.state === PluginState.FAILED).length,
      loading: plugins.filter((p) => p.state === PluginState.LOADING).length,
      unloaded: plugins.filter((p) => p.state === PluginState.UNLOADED).length,
    };
  }

  /**
   * 发射生命周期事件
   */
  private emitLifecycleEvent(
    event: PluginLifecycleEvent,
    plugin: LoadedPlugin | null,
    data?: any
  ): void {
    const context: LifecycleContext = {
      plugin: plugin as LoadedPlugin,
      timestamp: new Date(),
      error: data?.error,
    };

    this.emit(event, context);
    this.emit('lifecycleEvent', { event, context, data });
  }

  /**
   * 启动生命周期管理器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    await this.startAllPlugins();

    logger.info('✅ Plugin lifecycle manager started');
  }

  /**
   * 停止生命周期管理器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    await this.stopAllPlugins();

    this.isRunning = false;

    logger.info('✅ Plugin lifecycle manager stopped');
  }

  /**
   * 销毁生命周期管理器
   */
  async destroy(): Promise<void> {
    await this.stop();

    this.plugins.clear();
    this.lifecycleHooks.clear();

    logger.info('✅ Plugin lifecycle manager destroyed');
  }
}

export default PluginLifecycleManager;
