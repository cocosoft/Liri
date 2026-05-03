// @ts-nocheck
/**
 * WebSocket传输层
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { logger } from '../../utils/log';
import type { McpWebSocketServerConfig } from './types';

/**
 * WebSocket传输层实现
 */
export class WebSocketTransport {
  private config: McpWebSocketServerConfig;
  private client: Client | null = null;

  constructor(config: McpWebSocketServerConfig) {
    this.config = config;
  }

  /**
   * 连接到WebSocket服务器
   */
  async connect(): Promise<Client> {
    try {
      logger.info(`Connecting to WebSocket MCP server: ${this.config.url}`);

      // 构建WebSocket客户端选项
      const options = {
        transport: 'ws',
        url: this.config.url,
        headers: this.config.headers || {},
      };

      // 创建客户端
      const client = new Client(options);

      // 连接到服务器
      await client.connect();

      logger.info(`Connected to WebSocket MCP server: ${this.config.url}`);
      this.client = client;

      return client;
    } catch (error) {
      logger.error('WebSocket connection failed:', error);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
        logger.info(`Disconnected from WebSocket MCP server: ${this.config.url}`);
      } catch (error) {
        logger.error('Error disconnecting from WebSocket server:', error);
      } finally {
        this.client = null;
      }
    }
  }

  /**
   * 获取当前客户端
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.client !== null;
  }
}