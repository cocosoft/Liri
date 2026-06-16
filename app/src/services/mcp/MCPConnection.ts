/**
 * MCP服务器连接
 * 标准层连接管理，负责管理单个MCP服务器连接
 * 传输层和认证通过增强层组合使用 (via @modules/mcp/)
 */

import { randomUUID } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ level: LogLevel.INFO });
import {
  MCPServerConfig,
  MCPToolDefinition,
  MCPServerStatus,
} from './types';
import { TransportFactory } from './TransportFactory';
import { MCPTransport } from './transports/MCPTransport';
import { mcpAuthManager } from './auth/MCPAuth';
import { feature } from '@modules/featureflags';
import type { MCPOAuthConfig } from './auth/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * MCP服务器连接
 */
export class MCPConnection {
  private readonly name: string;
  private readonly config: MCPServerConfig;
  private transport: MCPTransport;
  private status: MCPServerStatus = MCPServerStatus.DISCONNECTED;
  private tools: MCPToolDefinition[] = [];
  private error: string | undefined;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private lastConnectedTime: number = 0;
  private pendingRequests: Map<
    string,
    { resolve: (response: any) => void; reject: (error: Error) => void }
  > = new Map();
  private batchUpdateTimer: NodeJS.Timeout | null = null;
  private batchRequests: any[] = [];
  private batchInterval: number = 100;

  constructor(name: string, config: MCPServerConfig) {
    this.name = name;
    this.config = config;
    this.transport = TransportFactory.createFromServerConfig(config);
  }

  /**
   * 连接到服务器
   */
  async connect(): Promise<boolean> {
    try {
      this.status = MCPServerStatus.CONNECTING;

      if (feature('MCP_OAUTH') && (this.config as any).oauth) {
        await this.handleOAuthAuthentication();
      }

      await this.transport.connect();
      this.status = MCPServerStatus.CONNECTED;
      this.lastConnectedTime = Date.now();
      this.reconnectAttempts = 0;

      await this.refreshTools();

      logger.info(`Connected to MCP server: ${this.name}`);
      return true;
    } catch (error) {
      this.status = MCPServerStatus.ERROR;
      this.error = error instanceof Error ? error.message : String(error);
      await handleError(error, { module: 'services:mcp:connection', action: 'connect', context: { serverName: this.name } });

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }

      return false;
    }
  }

  /**
   * 处理OAuth认证
   */
  private async handleOAuthAuthentication(): Promise<void> {
    const oauthConfig = this.buildOAuthConfig();
    if (!oauthConfig) {
      logger.warn(`OAuth config incomplete for MCP server: ${this.name}`);
      return;
    }

    const serverKey = this.name;

    try {
      const accessToken = await mcpAuthManager.getAccessToken(
        serverKey,
        oauthConfig
      );
      (this.transport as any).setAuthHeader?.(`Bearer ${accessToken}`);
      logger.info(
        `OAuth authentication successful for MCP server: ${this.name}`
      );
    } catch (error) {
      await handleError(error, { module: 'services:mcp:connection', action: 'oauth', context: { serverName: this.name } });
      throw error;
    }
  }

  /**
   * 构建OAuth配置
   */
  private buildOAuthConfig(): MCPOAuthConfig | null {
    const oauth = (this.config as any).oauth;
    if (!oauth?.clientId || !oauth.authServerMetadataUrl) {
      return null;
    }

    return {
      clientId: oauth.clientId,
      authUrl: oauth.authServerMetadataUrl,
      tokenUrl: oauth.authServerMetadataUrl.replace(
        '/.well-known/oauth-authorization-server',
        '/token'
      ),
      redirectUri: `http://localhost:${oauth.callbackPort || 3000}/callback`,
      scopes: ['read', 'write'],
    };
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    logger.info(
      `Scheduling MCP server ${this.name} reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(async () => {
      try {
        const success = await this.connect();
        if (success) {
          logger.info(`Successfully reconnected to MCP server: ${this.name}`);
        }
      } catch (error) {
        void handleError(error, { module: 'services:mcp:connection', action: 'reconnect', context: { serverName: this.name } });
      }
    }, delay);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.transport.disconnect();
    this.status = MCPServerStatus.DISCONNECTED;
    this.tools = [];
    this.reconnectAttempts = 0;

    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('Connection disconnected'));
    }
    this.pendingRequests.clear();

    if (this.batchUpdateTimer) {
      clearTimeout(this.batchUpdateTimer);
      this.batchUpdateTimer = null;
    }
    this.batchRequests = [];

    logger.info(`Disconnected from MCP server: ${this.name}`);
  }

  /**
   * 发送请求
   */
  async sendRequest(request: any): Promise<any> {
    if (!this.transport.isConnected()) {
      const connected = await this.connect();
      if (!connected) {
        throw new AppError(
          `Failed to connect to MCP server ${this.name}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });

      try {
        this.transport
          .send(request)
          .then((response) => {
            this.pendingRequests.delete(request.id);
            resolve(response);
          })
          .catch((error) => {
            this.pendingRequests.delete(request.id);
            this.handleTransportError(error);
            reject(error);
          });
      } catch (error) {
        this.pendingRequests.delete(request.id);
        this.handleTransportError(error as Error);
        reject(error);
      }
    });
  }

  /**
   * 批量发送请求
   */
  async batchSendRequests(requests: any[]): Promise<any[]> {
    if (requests.length === 0) {
      return [];
    }

    if (requests.length === 1) {
      return [await this.sendRequest(requests[0])];
    }

    const responsePromises = requests.map((request) => {
      return this.sendRequest(request);
    });

    return Promise.all(responsePromises);
  }

  /**
   * 添加到批量更新队列
   */
  queueBatchRequest(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });
      this.batchRequests.push(request);

      if (!this.batchUpdateTimer) {
        this.scheduleBatchUpdate();
      }
    });
  }

  /**
   * 调度批量更新
   */
  private scheduleBatchUpdate(): void {
    this.batchUpdateTimer = setTimeout(async () => {
      if (this.batchRequests.length > 0) {
        const requests = [...this.batchRequests];
        this.batchRequests = [];

        try {
          await this.batchSendRequests(requests);
        } catch (error) {
          logger.error('Batch update failed:', error as Error);
        }
      }
      this.batchUpdateTimer = null;
    }, this.batchInterval);
  }

  /**
   * 处理传输层错误
   */
  private handleTransportError(error: Error): void {
    this.status = MCPServerStatus.ERROR;
    this.error = error.message;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  /**
   * 调用工具
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const request = {
      id: randomUUID(),
      type: 'call',
      tool_name: toolName,
      args,
    };

    const response = await this.sendRequest(request);

    if (response.type === 'error') {
      throw new AppError(
        response.error?.message || 'Tool call failed',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return response.result;
  }

  /**
   * 刷新工具列表
   */
  async refreshTools(): Promise<MCPToolDefinition[]> {
    const request = {
      id: randomUUID(),
      type: 'list_tools',
    };

    const response = await this.sendRequest(request);

    if (response.type === 'error') {
      throw new AppError(
        response.error?.message || 'Failed to list tools',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.tools = response.tools || [];
    return this.tools;
  }

  /**
   * 批量刷新工具列表
   */
  static async batchRefreshTools(
    connections: MCPConnection[]
  ): Promise<Map<string, MCPToolDefinition[]>> {
    const result = new Map<string, MCPToolDefinition[]>();
    const refreshPromises = connections.map(async (connection) => {
      try {
        if (connection.isConnected()) {
          const tools = await connection.refreshTools();
          result.set(connection.getName(), tools);
        }
      } catch (error) {
        await handleError(error, { module: 'services:mcp:connection', action: 'batch_refresh_tools', context: { serverName: connection.getName() } });
      }
    });

    await Promise.all(refreshPromises);
    return result;
  }

  getTools(): MCPToolDefinition[] {
    return this.tools;
  }

  getName(): string {
    return this.name;
  }

  getConfig(): MCPServerConfig {
    return this.config;
  }

  getStatus(): MCPServerStatus {
    return this.status;
  }

  setStatus(status: MCPServerStatus): void {
    this.status = status;
  }

  getError(): string | undefined {
    return this.error;
  }

  isConnected(): boolean {
    return this.status === MCPServerStatus.CONNECTED;
  }

  /**
   * 发送ping请求检查服务器健康状态
   */
  async ping(): Promise<boolean> {
    const request = {
      id: randomUUID(),
      type: 'ping',
    };

    try {
      const response = await this.sendRequest(request);
      return response.type === 'pong';
    } catch (error) {
      this.handleTransportError(error as Error);
      throw error;
    }
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  getLastConnectedTime(): number {
    return this.lastConnectedTime;
  }

  isReconnecting(): boolean {
    return (
      this.reconnectAttempts > 0 && this.status !== MCPServerStatus.CONNECTED
    );
  }

  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}
