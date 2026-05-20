/**
 * MCP传输层工厂（统一实现）
 * 负责创建不同类型的传输层实例
 */

import { MCPTransport } from '../../mcp/transports/MCPTransport';
import { HTTPTransport } from '../../mcp/transports/HTTPTransport';
import { StdioTransport } from '../../mcp/transports/StdioTransport';
import { WebSocketTransport } from '../../mcp/transports/WebSocketTransport';
import { SSETransport } from '../../mcp/transports/SSETransport';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { MCPServerConfig } from '../../mcp/types';
import type { McpTlsConfig } from './transports/McpTlsManager';

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
  tls?: Partial<McpTlsConfig>;
}

/**
 * MCP传输层工厂
 */
export class TransportFactory {
  static createTransport(config: TransportConfig): MCPTransport {
    switch (config.type) {
      case 'http':
        if (!config.url) {
          throw new AppError(
            'HTTP transport requires url',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            '600'
          );
        }
        return new HTTPTransport({
          url: config.url,
          headers: config.headers,
          tls: config.tls,
        });

      case 'stdio':
        if (!config.command) {
          throw new AppError(
            'Stdio transport requires command',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            '600'
          );
        }
        return new StdioTransport({
          command: config.command,
          args: config.args,
          env: config.env,
        });

      case 'ws':
        if (!config.url) {
          throw new AppError(
            'WebSocket transport requires url',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            '600'
          );
        }
        return new WebSocketTransport({
          url: config.url,
          headers: config.headers,
          connectTimeout: config.connectTimeout,
          requestTimeout: config.requestTimeout,
          tls: config.tls,
        });

      case 'sse':
        if (!config.url) {
          throw new AppError(
            'SSE transport requires url',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            '600'
          );
        }
        return new SSETransport({
          url: config.url,
          headers: config.headers,
          tls: config.tls,
        });

      default:
        throw new AppError(
          `Unknown transport type: ${config.type}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          '600'
        );
    }
  }

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
      tls: serverConfig.tls,
    };

    return this.createTransport(transportConfig);
  }

  static getSupportedTransportTypes(): string[] {
    return ['stdio', 'http', 'ws', 'sse'];
  }

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
      tls: urlOrConfig.tls,
    });
  }
}
