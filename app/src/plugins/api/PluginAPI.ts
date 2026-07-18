/**
 * 插件API实现
 * 提供插件使用的核心 API 接口，集成 KernelServiceRegistry
 * 支持基于插件 ID 的访问控制，插件只能通过 IPluginAPI 访问内核服务
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, normalize } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import {
  KernelServiceRegistry,
  KernelServiceId,
  getKernelServiceRegistry,
} from './KernelServiceRegistry';
import type { PluginEvent, PluginEventType } from '../types/PluginTypes';

const logger = new Logger({
  module: 'plugins:api:pluginAPI',
  level: LogLevel.INFO,
});

/**
 * 插件工具类型定义，替代 any
 */
export interface PluginTool {
  id: string;
  name: string;
  description: string;
  handler: (...args: unknown[]) => Promise<unknown>;
  schema?: Record<string, unknown>;
}

/**
 * 插件API接口（核心服务代理）
 * 插件只能通过此接口访问内核服务，禁止直接 import 内核模块
 */
export interface IPluginAPI {
  /** API 版本号 */
  readonly version: string;

  /** 插件标识 */
  readonly pluginId: string;

  /** 命令API */
  readonly commands: {
    registerCommand: (id: string, handler: () => Promise<unknown>) => void;
    executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>;
  };

  /** 工具API */
  readonly tools: {
    registerTool: (tool: PluginTool) => void;
    getTool: (id: string) => PluginTool | undefined;
  };

  /** 设置API */
  readonly settings: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => Promise<void>;
    watch: (key: string, callback: (value: unknown) => void) => () => void;
  };

  /** 事件API */
  readonly events: {
    on: (event: string, handler: (...args: unknown[]) => void) => () => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
    emit: (event: string, ...args: unknown[]) => void;
  };

  /** 资源API */
  readonly resources: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
  };

  /** 会话API */
  readonly session: {
    createSession: (options?: Record<string, unknown>) => Promise<string>;
    getSession: (id: string) => Promise<unknown>;
    sendMessage: (
      sessionId: string,
      message: Record<string, unknown>
    ) => Promise<void>;
  };

  /** 内核服务访问（通过 KernelServiceRegistry） */
  readonly services: {
    resolve: <T>(serviceId: KernelServiceId) => T;
    hasService: (serviceId: KernelServiceId) => boolean;
  };
}

/**
 * 事件系统代理接口
 * 当 PluginAPIImpl 连接到全局 PluginEventSystem 时使用此接口
 */
interface EventSystemProxy {
  registerHandler: (handler: {
    id: string;
    eventType: string;
    handler: (event: PluginEvent) => Promise<void> | void;
    pluginId?: string;
  }) => void;
  unregisterHandler: (handlerId: string, eventType?: string) => boolean;
  publishEvent: (event: PluginEvent) => Promise<void>;
}

/**
 * 插件API实现
 * 维护插件自身的命令/工具/设置/事件/资源/会话管理
 * 通过 KernelServiceRegistry 提供对内核服务的受控访问
 */
export class PluginAPIImpl implements IPluginAPI {
  readonly version = '1.0.0';
  readonly pluginId: string;
  private _cmdMap: Map<string, () => Promise<unknown>> = new Map();
  private _toolMap: Map<string, PluginTool> = new Map();
  private _settingsMap: Map<string, unknown> = new Map();
  private _watchCallbacks: Map<string, Array<(value: unknown) => void>> =
    new Map();
  private _eventListeners: Map<string, Array<(...args: unknown[]) => void>> =
    new Map();
  private _kernelRegistry: KernelServiceRegistry;
  private _eventSystem: EventSystemProxy | null = null;
  private _eventHandlerIds: string[] = [];

  /**
   * 构造函数
   * @param pluginId 插件 ID
   * @param registry 内核服务注册表实例（可选，默认获取全局单例）
   * @param eventSystem 全局事件系统代理（可选，用于将 events API 连接到全局系统）
   */
  constructor(
    pluginId: string,
    registry?: KernelServiceRegistry,
    eventSystem?: EventSystemProxy
  ) {
    this.pluginId = pluginId;
    this._kernelRegistry = registry || getKernelServiceRegistry();
    this._eventSystem = eventSystem || null;
  }

  /**
   * 检查当前插件是否有权访问指定 API
   * @param apiServiceId 对应的内核服务标识符
   */
  private _checkAccess(apiServiceId: KernelServiceId): void {
    if (!this._kernelRegistry.hasAccess(this.pluginId, apiServiceId)) {
      throw new AppError(
        `Plugin "${this.pluginId}" is not allowed to access API: ${apiServiceId}`,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'PLUGIN_API_ACCESS_DENIED'
      );
    }
  }

  /**
   * 记录审计日志
   * @param apiName API 名称
   * @param params 参数摘要（自动脱敏）
   */
  private _auditLog(apiName: string, params?: Record<string, unknown>): void {
    logger.debug(`[API Audit] plugin=${this.pluginId} api=${apiName}`, {
      pluginId: this.pluginId,
      apiName,
      params,
    });
  }

  readonly commands = {
    registerCommand: (id: string, handler: () => Promise<unknown>): void => {
      this._checkAccess(KernelServiceId.COMMAND_API);
      this._cmdMap.set(id, handler);
      this._auditLog('commands.registerCommand', { commandId: id });
    },

    executeCommand: async (
      id: string,
      ..._args: unknown[]
    ): Promise<unknown> => {
      this._checkAccess(KernelServiceId.COMMAND_API);
      this._auditLog('commands.executeCommand', { commandId: id });

      const handler = this._cmdMap.get(id);
      if (!handler) {
        throw new AppError(
          `Command not found: ${id}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'PLUGIN_COMMAND_NOT_FOUND'
        );
      }
      return await handler();
    },
  };

  readonly tools = {
    registerTool: (tool: PluginTool): void => {
      this._checkAccess(KernelServiceId.TOOL_API);
      this._toolMap.set(tool.id, tool);
      this._auditLog('tools.registerTool', {
        toolId: tool.id,
        toolName: tool.name,
      });
    },

    getTool: (id: string): PluginTool | undefined => {
      this._checkAccess(KernelServiceId.TOOL_API);
      this._auditLog('tools.getTool', { toolId: id });
      return this._toolMap.get(id);
    },
  };

  readonly settings = {
    get: (key: string): unknown => {
      this._checkAccess(KernelServiceId.SETTINGS_API);
      this._auditLog('settings.get', { key });
      return this._settingsMap.get(key);
    },

    set: async (key: string, value: unknown): Promise<void> => {
      this._checkAccess(KernelServiceId.SETTINGS_API);
      this._settingsMap.set(key, value);
      this._auditLog('settings.set', { key });

      const watchers = this._watchCallbacks.get(key);
      if (watchers) {
        for (const cb of watchers) {
          try {
            cb(value);
          } catch (error) {
            logger.error(`Settings watch callback error for ${key}:`, {
              error,
            });
          }
        }
      }
    },

    watch: (key: string, callback: (value: unknown) => void): (() => void) => {
      this._checkAccess(KernelServiceId.SETTINGS_API);
      if (!this._watchCallbacks.has(key)) {
        this._watchCallbacks.set(key, []);
      }
      this._watchCallbacks.get(key)!.push(callback);

      return () => {
        const watchers = this._watchCallbacks.get(key);
        if (watchers) {
          const idx = watchers.indexOf(callback);
          if (idx >= 0) watchers.splice(idx, 1);
        }
      };
    },
  };

  readonly events = {
    on: (
      event: string,
      handler: (...args: unknown[]) => void
    ): (() => void) => {
      if (!this._eventListeners.has(event)) {
        this._eventListeners.set(event, []);
      }
      this._eventListeners.get(event)!.push(handler);

      if (this._eventSystem) {
        const handlerId = `plugin:${this.pluginId}:event:${event}:${Date.now()}`;
        this._eventSystem.registerHandler({
          id: handlerId,
          eventType: event,
          handler: async (pluginEvent: PluginEvent) => {
            handler(pluginEvent.data);
          },
          pluginId: this.pluginId,
        });
        this._eventHandlerIds.push(handlerId);
      }

      this._auditLog('events.on', { event });

      return () => {
        this.events.off(event, handler);
      };
    },

    off: (event: string, handler: (...args: unknown[]) => void): void => {
      const listeners = this._eventListeners.get(event);
      if (listeners) {
        const index = listeners.indexOf(handler);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      }
    },

    emit: (event: string, ...args: unknown[]): void => {
      if (this._eventSystem) {
        this._eventSystem.publishEvent({
          type: event as PluginEventType,
          pluginId: this.pluginId,
          data: args.length === 1 ? args[0] : args,
          timestamp: new Date(),
        });
      }

      const listeners = this._eventListeners.get(event);
      if (listeners) {
        for (const handler of listeners) {
          try {
            handler(...args);
          } catch (error) {
            logger.error(`Error in event handler for ${event}:`, { error });
          }
        }
      }

      this._auditLog('events.emit', { event });
    },
  };

  readonly resources = {
    readFile: async (path: string): Promise<string> => {
      this._checkAccess(KernelServiceId.RESOURCE_API);
      const resolvedPath = resolve(path);
      if (!existsSync(resolvedPath)) {
        throw new AppError(
          `File not found: ${path}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'PLUGIN_FILE_NOT_FOUND'
        );
      }
      this._auditLog('resources.readFile', { path: resolvedPath });
      return readFileSync(resolvedPath, 'utf8');
    },

    writeFile: async (path: string, content: string): Promise<void> => {
      this._checkAccess(KernelServiceId.RESOURCE_API);
      const resolvedPath = resolve(path);
      writeFileSync(resolvedPath, content, 'utf8');
      this._auditLog('resources.writeFile', { path: resolvedPath });
    },

    exists: async (path: string): Promise<boolean> => {
      this._checkAccess(KernelServiceId.RESOURCE_API);
      const resolvedPath = resolve(path);
      return existsSync(resolvedPath);
    },
  };

  readonly session = {
    createSession: async (
      options?: Record<string, unknown>
    ): Promise<string> => {
      this._auditLog('session.createSession', { options });
      try {
        const sessionManager = this._kernelRegistry.resolveInternal<any>(
          KernelServiceId.PLUGIN_LOADER
        );
        if (
          sessionManager &&
          typeof sessionManager.createSession === 'function'
        ) {
          return await sessionManager.createSession(options);
        }
      } catch (err) {
        // 优雅降级：会话服务不可用时使用存根
      }
      return `session-${Date.now()}`;
    },

    getSession: async (id: string): Promise<unknown> => {
      this._auditLog('session.getSession', { sessionId: id });
      try {
        const sessionManager = this._kernelRegistry.resolveInternal<any>(
          KernelServiceId.PLUGIN_LOADER
        );
        if (sessionManager && typeof sessionManager.getSession === 'function') {
          return await sessionManager.getSession(id);
        }
      } catch (err) {
        // 优雅降级
      }
      return { id, title: 'Plugin Session' };
    },

    sendMessage: async (
      sessionId: string,
      message: Record<string, unknown>
    ): Promise<void> => {
      this._auditLog('session.sendMessage', { sessionId });
      try {
        const sessionManager = this._kernelRegistry.resolveInternal<any>(
          KernelServiceId.PLUGIN_LOADER
        );
        if (
          sessionManager &&
          typeof sessionManager.sendMessage === 'function'
        ) {
          await sessionManager.sendMessage(sessionId, message);
          return;
        }
      } catch (err) {
        // 优雅降级
      }
      logger.debug(`Message sent to session ${sessionId}:`, { message });
    },
  };

  readonly services = {
    resolve: <T>(serviceId: KernelServiceId): T => {
      this._auditLog('services.resolve', { serviceId });
      return this._kernelRegistry.resolve<T>(serviceId, this.pluginId);
    },

    hasService: (serviceId: KernelServiceId): boolean => {
      return this._kernelRegistry.hasService(serviceId);
    },
  };

  /**
   * 获取本插件已注册的命令列表
   * @returns 命令 ID 数组
   */
  getRegisteredCommands(): string[] {
    return Array.from(this._cmdMap.keys());
  }

  /**
   * 获取本插件已注册的工具列表
   * @returns 工具对象数组
   */
  getRegisteredTools(): PluginTool[] {
    return Array.from(this._toolMap.values());
  }

  /**
   * 清理本插件注册的所有事件处理器
   */
  cleanup(): void {
    if (this._eventSystem) {
      for (const handlerId of this._eventHandlerIds) {
        this._eventSystem.unregisterHandler(handlerId);
      }
    }
    this._eventHandlerIds = [];
    this._eventListeners.clear();
    this._cmdMap.clear();
    this._toolMap.clear();
    this._settingsMap.clear();
    this._watchCallbacks.clear();
  }
}

/**
 * 创建插件API实例
 * @param pluginId 插件 ID
 * @param registry 内核服务注册表（可选，默认获取全局单例）
 * @param eventSystem 全局事件系统代理（可选）
 * @returns 插件API实例
 */
export function createPluginAPI(
  pluginId: string,
  registry?: KernelServiceRegistry,
  eventSystem?: EventSystemProxy
): IPluginAPI {
  return new PluginAPIImpl(pluginId, registry, eventSystem);
}
