//
/**
 * SSE传输层
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { logger } from '@modules/utils/log';
import type { McpSSEServerConfig } from './types';

/**
 * SSE传输层实现
 */
export class SSETransport {
  private config: McpSSEServerConfig;
  private client: Client | null = null;

  constructor(config: McpSSEServerConfig) {
    this.config = config;
  }

  /**
   * 连接到SSE服务器
   */
  async connect(): Promise<Client> {
    try {
      logger.info(`Connecting to SSE MCP server: ${this.config.url}`);

      const options = {
        transport: 'sse',
        url: this.config.url,
        headers: this.config.headers || {},
      };

      const client = new Client(options as any);
      await (client as any).connect();

      logger.info(`Connected to SSE MCP server: ${this.config.url}`);
      this.client = client;

      return client;
    } catch (error) {
      logger.error(
        'SSE connection failed:',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await (this.client as any).close();
        logger.info(`Disconnected from SSE MCP server: ${this.config.url}`);
      } catch (error) {
        logger.error(
          'Error disconnecting from SSE server:',
          error instanceof Error ? error : new Error(String(error))
        );
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
