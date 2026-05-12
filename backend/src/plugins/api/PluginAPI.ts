/**
 * 插件API实现
 * 提供给插件使用的各种API接口
 */

import type { PluginAPI } from './types/Plugin.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 插件API实现
 */
export class PluginAPIImpl implements PluginAPI {
  /**
   * 命令映射
   */
  private commands: Map<string, () => Promise<void>> = new Map();

  /**
   * 工具映射
   */
  private tools: Map<string, any> = new Map();

  /**
   * 设置映射
   */
  private settings: Map<string, unknown> = new Map();

  /**
   * 事件监听器
   */
  private eventListeners: Map<string, Array<(...args: unknown[]) => void>> =
    new Map();

  /**
   * 命令API
   */
  commands = {
    /**
     * 注册命令
     * @param id 命令ID
     * @param handler 命令处理函数
     */
    registerCommand: (id: string, handler: () => Promise<void>): void => {
      this.commands.set(id, handler);
    },

    /**
     * 执行命令
     * @param id 命令ID
     * @param args 命令参数
     * @returns 命令执行结果
     */
    executeCommand: async (
      id: string,
      ...args: unknown[]
    ): Promise<unknown> => {
      const handler = this.commands.get(id);
      if (!handler) {
        throw new AppError(`Command not found: ${id}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      }
      return await handler();
    },
  };

  /**
   * 工具API
   */
  tools = {
    /**
     * 注册工具
     * @param tool 工具对象
     */
    registerTool: (tool: any): void => {
      if (tool.id) {
        this.tools.set(tool.id, tool);
      }
    },

    /**
     * 获取工具
     * @param id 工具ID
     * @returns 工具对象
     */
    getTool: (id: string): any | undefined => {
      return this.tools.get(id);
    },
  };

  /**
   * 设置API
   */
  settings = {
    /**
     * 获取设置
     * @param key 设置键
     * @returns 设置值
     */
    get: (key: string): unknown => {
      return this.settings.get(key);
    },

    /**
     * 设置设置
     * @param key 设置键
     * @param value 设置值
     */
    set: async (key: string, value: unknown): Promise<void> => {
      this.settings.set(key, value);
    },

    /**
     * 监听设置变化
     * @param key 设置键
     * @param callback 回调函数
     * @returns 取消监听函数
     */
    watch: (key: string, callback: (value: unknown) => void): (() => void) => {
      // 简化实现，实际应该支持真正的监听
      return () => {
        // 取消监听
      };
    },
  };

  /**
   * 事件API
   */
  events = {
    /**
     * 注册事件监听器
     * @param event 事件名称
     * @param handler 事件处理函数
     */
    on: (event: string, handler: (...args: unknown[]) => void): void => {
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, []);
      }
      this.eventListeners.get(event)!.push(handler);
    },

    /**
     * 移除事件监听器
     * @param event 事件名称
     * @param handler 事件处理函数
     */
    off: (event: string, handler: (...args: unknown[]) => void): void => {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        const index = listeners.indexOf(handler);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      }
    },

    /**
     * 触发事件
     * @param event 事件名称
     * @param args 事件参数
     */
    emit: (event: string, ...args: unknown[]): void => {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        for (const handler of listeners) {
          try {
            handler(...args);
          } catch (error) {
            logger.error(`Error in event handler for ${event}:`, { error });
          }
        }
      }
    },
  };

  /**
   * 资源API
   */
  resources = {
    /**
     * 读取文件
     * @param path 文件路径
     * @returns 文件内容
     */
    readFile: async (path: string): Promise<string> => {
      const resolvedPath = resolve(path);
      if (!existsSync(resolvedPath)) {
        throw new AppError(`File not found: ${path}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      }
      return readFileSync(resolvedPath, 'utf8');
    },

    /**
     * 写入文件
     * @param path 文件路径
     * @param content 文件内容
     */
    writeFile: async (path: string, content: string): Promise<void> => {
      const resolvedPath = resolve(path);
      writeFileSync(resolvedPath, content, 'utf8');
    },

    /**
     * 检查文件是否存在
     * @param path 文件路径
     * @returns 是否存在
     */
    exists: async (path: string): Promise<boolean> => {
      const resolvedPath = resolve(path);
      return existsSync(resolvedPath);
    },
  };

  /**
   * 会话API
   */
  session = {
    /**
     * 创建会话
     * @param options 会话选项
     * @returns 会话ID
     */
    createSession: async (options?: any): Promise<string> => {
      return `session-${Date.now()}`;
    },

    /**
     * 获取会话
     * @param id 会话ID
     * @returns 会话对象
     */
    getSession: async (id: string): Promise<any> => {
      return { id, title: 'Test Session' };
    },

    /**
     * 发送消息
     * @param sessionId 会话ID
     * @param message 消息对象
     */
    sendMessage: async (sessionId: string, message: any): Promise<void> => {
      logger.debug(`Message sent to session ${sessionId}:`, { message });
    },
  };
}

/**
 * 创建插件API实例
 * @returns 插件API实例
 */
export function createPluginAPI(): PluginAPI {
  return new PluginAPIImpl();
}
