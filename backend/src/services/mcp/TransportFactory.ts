/**
 * 传输层工厂
 * 负责创建不同类型的传输层实例
 */

import { logger } from '../../utils/log';
import { WebSocketTransport } from './WebSocketTransport';
import { SSETransport } from './SSETransport';
import type { McpServerConfig } from './types';

/**
 * 传输层工厂
 */
export class TransportFactory {
  /**
   * 创建传输层实例
   * @param config 服务器配置
   * @returns 传输层实例
   */
  static createTransport(config: McpServerConfig) {
    switch (config.type) {
      case 'ws':
        logger.info('Creating WebSocket transport');
        return new WebSocketTransport(config);
      case 'sse':
        logger.info('Creating SSE transport');
        return new SSETransport(config);
      case 'http':
        logger.info('Using HTTP transport (built-in)');
        return null; // HTTP使用内置传输
      case 'stdio':
        logger.info('Using Stdio transport (built-in)');
        return null; // Stdio使用内置传输
      case 'sdk':
        logger.info('Using SDK transport (built-in)');
        return null; // SDK使用内置传输
      default:
        logger.warn(`Unknown transport type: ${config.type}`);
        return null;
    }
  }

  /**
   * 获取传输层显示名称
   * @param transportType 传输层类型
   * @returns 显示名称
   */
  static getTransportDisplayName(transportType: string): string {
    const displayNames: Record<string, string> = {
      ws: 'WebSocket',
      sse: 'SSE',
      http: 'HTTP',
      stdio: 'Stdio',
      sdk: 'SDK',
    };
    return displayNames[transportType] || transportType;
  }
}