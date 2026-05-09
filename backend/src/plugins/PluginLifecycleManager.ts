/**
 * 插件生命周期管理器
 * 负责管理插件的完整生命周期和状态转换
 */

import type { LoadedPlugin } from '../types/plugin';
import { EventEmitter } from 'events';

export enum PluginLifecycleEvent {
  BEFORE_INITIALIZE = 'beforeInitialize',
  AFTER_INITIALIZE = 'afterInitialize',
  BEFORE_START = 'beforeStart',
  AFTER_START = 'afterStart',
  BEFORE_STOP = 'beforeStop',
  AFTER_STOP = 'afterStop',
  BEFORE_UNLOAD = 'beforeUnload',
  AFTER_UNLOAD = 'afterUnload',
  ERROR = 'error',
  STATUS_CHANGED = 'statusChanged',
}

export interface LifecycleHook {
  name: string;
  handler: (plugin: LoadedPlugin) => Promise<void> | void;
  priority?: number;
}

export interface LifecycleContext {
  plugin: LoadedPlugin;
  timestamp: Date;
  error?: Error;
}

export class PluginLifecycleManager extends EventEmitter {
  private hooks: Map<PluginLifecycleEvent, LifecycleHook[]> = new Map();
  private pluginStates: Map<string, LifecycleContext[]> = new Map();

  constructor() {
    super();
    this.initializeDefaultHooks();
  }

  private initializeDefaultHooks(): void {
    this.on(PluginLifecycleEvent.ERROR, (context: LifecycleContext) => {
      console.error(
        `[PluginLifecycle] Plugin ${context.plugin.name} error:`,
        context.error
      );
    });

    this.on(
      PluginLifecycleEvent.STATUS_CHANGED,
      (context: LifecycleContext) => {
        console.log(
          `[PluginLifecycle] Plugin ${context.plugin.name} status changed`
        );
      }
    );
  }

  public registerHook(event: PluginLifecycleEvent, hook: LifecycleHook): void {
    const hooks = this.hooks.get(event) || [];
    hooks.push(hook);
    hooks.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.hooks.set(event, hooks);
  }

  public unregisterHook(event: PluginLifecycleEvent, hookName: string): void {
    const hooks = this.hooks.get(event) || [];
    const filtered = hooks.filter((h) => h.name !== hookName);
    this.hooks.set(event, filtered);
  }

  public async emitLifecycleEvent(
    event: PluginLifecycleEvent,
    plugin: LoadedPlugin,
    error?: Error
  ): Promise<void> {
    const context: LifecycleContext = {
      plugin,
      timestamp: new Date(),
      error,
    };

    this.recordState(plugin.name, context);

    const hooks = this.hooks.get(event) || [];
    for (const hook of hooks) {
      try {
        await hook.handler(plugin);
      } catch (hookError) {
        console.error(
          `[PluginLifecycle] Hook ${hook.name} failed for ${event}:`,
          hookError
        );
      }
    }

    this.emit(event, context);
  }

  private recordState(pluginName: string, context: LifecycleContext): void {
    const states = this.pluginStates.get(pluginName) || [];
    states.push(context);

    if (states.length > 100) {
      states.shift();
    }

    this.pluginStates.set(pluginName, states);
  }

  public getPluginHistory(pluginName: string): LifecycleContext[] {
    return this.pluginStates.get(pluginName) || [];
  }

  public async initializePlugin(plugin: LoadedPlugin): Promise<void> {
    await this.emitLifecycleEvent(
      PluginLifecycleEvent.BEFORE_INITIALIZE,
      plugin
    );

    try {
      if (plugin.instance?.initialize) {
        await plugin.instance.initialize();
      }

      await this.emitLifecycleEvent(
        PluginLifecycleEvent.AFTER_INITIALIZE,
        plugin
      );
    } catch (error) {
      await this.emitLifecycleEvent(
        PluginLifecycleEvent.ERROR,
        plugin,
        error as Error
      );
      throw error;
    }
  }

  public async startPlugin(plugin: LoadedPlugin): Promise<void> {
    await this.emitLifecycleEvent(PluginLifecycleEvent.BEFORE_START, plugin);

    try {
      if (plugin.instance?.start) {
        await plugin.instance.start();
      }

      await this.emitLifecycleEvent(PluginLifecycleEvent.AFTER_START, plugin);
    } catch (error) {
      await this.emitLifecycleEvent(
        PluginLifecycleEvent.ERROR,
        plugin,
        error as Error
      );
      throw error;
    }
  }

  public async stopPlugin(plugin: LoadedPlugin): Promise<void> {
    await this.emitLifecycleEvent(PluginLifecycleEvent.BEFORE_STOP, plugin);

    try {
      if (plugin.instance?.stop) {
        await plugin.instance.stop();
      }

      await this.emitLifecycleEvent(PluginLifecycleEvent.AFTER_STOP, plugin);
    } catch (error) {
      await this.emitLifecycleEvent(
        PluginLifecycleEvent.ERROR,
        plugin,
        error as Error
      );
      throw error;
    }
  }

  public async unloadPlugin(plugin: LoadedPlugin): Promise<void> {
    await this.emitLifecycleEvent(PluginLifecycleEvent.BEFORE_UNLOAD, plugin);

    try {
      if (plugin.instance?.unload) {
        await plugin.instance.unload();
      }

      await this.emitLifecycleEvent(PluginLifecycleEvent.AFTER_UNLOAD, plugin);
    } catch (error) {
      await this.emitLifecycleEvent(
        PluginLifecycleEvent.ERROR,
        plugin,
        error as Error
      );
      throw error;
    }
  }

  public getLifecycleStats(): {
    totalEvents: number;
    pluginsWithErrors: string[];
  } {
    const pluginsWithErrors = new Set<string>();

    for (const [pluginName, states] of this.pluginStates.entries()) {
      const hasErrors = states.some((s) => s.error);
      if (hasErrors) {
        pluginsWithErrors.add(pluginName);
      }
    }

    let totalEvents = 0;
    for (const states of this.pluginStates.values()) {
      totalEvents += states.length;
    }

    return {
      totalEvents,
      pluginsWithErrors: Array.from(pluginsWithErrors),
    };
  }
}

export const pluginLifecycleManager = new PluginLifecycleManager();
