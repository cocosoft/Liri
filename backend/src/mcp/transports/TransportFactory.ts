/**
 * MCP传输层工厂
 * 根据配置创建不同类型的传输层实例
 */

import { MCPTransport } from './MCPTransport';
import { HTTPTransport } from './HTTPTransport';
import { StdioTransport } from './StdioTransport';
import { WebSocketTransport } from './WebSocketTransport';
import { SSETransport } from './SSETransport';
import { MCPServerConfig } from '../types';

/**
 * 传输层配置
 */
export interface TransportConfig {
  type: 'stdio' | 'http' | 'ws' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
  connectTimeout?: number;
  requestTimeout?: number;
}

/**
 * MCP传输层工厂
 */
export class TransportFactory {
  /**
   * 创建传输层实例
   * @param config 传输层配置
   * @returns 传输层实例
   */
  static createTransport(config: TransportConfig): MCPTransport {
    switch (config.type) {
      case 'http':
        if (!config.url) {
          throw new Error('HTTP transport requires url');
        }
        return new HTTPTransport({
          url: config.url,
          headers: config.headers,
        });

      case 'stdio':
        if (!config.command) {
          throw new Error('Stdio transport requires command');
        }
        return new StdioTransport({
          command: config.command,
          args: config.args,
          env: config.env,
        });

      case 'ws':
        if (!config.url) {
          throw new Error('WebSocket transport requires url');
        }
        return new WebSocketTransport({
          url: config.url,
          headers: config.headers,
          connectTimeout: config.connectTimeout,
          requestTimeout: config.requestTimeout,
        });

      case 'sse':
        if (!config.url) {
          throw new Error('SSE transport requires url');
        }
        return new SSETransport({
          url: config.url,
          headers: config.headers,
        });

      default:
        throw new Error(`Unknown transport type: ${config.type}`);
    }
  }

  /**
   * 从MCP服务器配置创建传输层
   * @param serverConfig MCP服务器配置
   * @returns 传输层实例
   */
  static createFromServerConfig(serverConfig: MCPServerConfig): MCPTransport {
    const transportType = (serverConfig.type || 'stdio') as
      | 'stdio'
      | 'http'
      | 'ws'
      | 'sse';

    const transportConfig: TransportConfig = {
      type: transportType,
      url: serverConfig.url,
      command: serverConfig.command,
      args: serverConfig.args,
      headers: serverConfig.headers,
      env: serverConfig.env,
    };

    return this.createTransport(transportConfig);
  }

  /**
   * 获取支持的传输层类型
   * @returns 支持的传输层类型列表
   */
  static getSupportedTransportTypes(): string[] {
    return ['stdio', 'http', 'ws', 'sse'];
  }

  /**
   * 验证传输层配置
   * @param config 传输层配置
   * @returns 验证结果
   */
  static validateTransportConfig(config: TransportConfig): {
    valid: boolean;
    error?: string;
  } {
    switch (config.type) {
      case 'http':
        if (!config.url) {
          return { valid: false, error: 'HTTP transport requires url' };
        }
        break;

      case 'stdio':
        if (!config.command) {
          return { valid: false, error: 'Stdio transport requires command' };
        }
        break;

      case 'ws':
        if (!config.url) {
          return { valid: false, error: 'WebSocket transport requires url' };
        }
        break;

      case 'sse':
        if (!config.url) {
          return { valid: false, error: 'SSE transport requires url' };
        }
        break;

      default:
        return {
          valid: false,
          error: `Unknown transport type: ${config.type}`,
        };
    }

    return { valid: true };
  }

  /**
   * 根据URL自动检测传输类型
   * @param url URL
   * @returns 检测到的传输类型
   */
  static detectTransportType(url: string): 'http' | 'ws' | 'sse' | 'stdio' {
    if (!url) {
      return 'stdio';
    }
    if (url.startsWith('ws://') || url.startsWith('wss://')) {
      return 'ws';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (url.includes('/sse') || url.includes('/stream')) {
        return 'sse';
      }
      return 'http';
    }
    return 'stdio';
  }

  /**
   * 创建自动检测类型的传输层
   * @param urlOrConfig URL或配置对象
   * @returns 传输层实例
   */
  static createAutoTransport(
    urlOrConfig: string | MCPServerConfig
  ): MCPTransport {
    if (typeof urlOrConfig === 'string') {
      const type = this.detectTransportType(urlOrConfig);
      return this.createTransport({ type, url: urlOrConfig });
    }

    const type = (urlOrConfig.type ||
      this.detectTransportType(urlOrConfig.url || '')) as
      | 'stdio'
      | 'http'
      | 'ws'
      | 'sse';

    return this.createTransport({
      type,
      url: urlOrConfig.url,
      command: urlOrConfig.command,
      args: urlOrConfig.args,
      headers: urlOrConfig.headers,
      env: urlOrConfig.env,
    });
  }
}
