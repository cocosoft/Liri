/**
 * MCP服务器连接
 * 负责管理与单个MCP服务器的连接
 */

import { randomUUID } from 'crypto';
import { logger } from '@modules/utils/log';
import {
  MCPServerConfig,
  MCPToolDefinition,
  MCPRequest,
  MCPResponse,
  MCPServerStatus,
} from '../types';
import { TransportFactory } from '../transports/TransportFactory';
import { MCPTransport } from '../transports/MCPTransport';
import { mcpAuthManager } from '../auth/MCPAuth.js';
import { feature } from '@modules/featureflags';
import { MCPOAuthConfig } from '../auth/types.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * MCP服务器连接
 */
export class MCPServerConnection {
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
    { resolve: (response: MCPResponse) => void; reject: (error: Error) => void }
  > = new Map();
  private batchUpdateTimer: NodeJS.Timeout | null = null;
  private batchRequests: MCPRequest[] = [];
  private batchInterval: number = 100; // 批量更新间隔（毫秒）

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
      logger.error(
        `Failed to connect to MCP server ${this.name}: ${this.error}`
      );

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
      logger.error(
        `OAuth authentication failed for MCP server ${this.name}: ${error}`
      );
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
        logger.error(
          `MCP server ${this.name} reconnect failed:`,
          error as Error
        );
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

    // 拒绝所有未完成的请求
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('Connection disconnected'));
    }
    this.pendingRequests.clear();

    // 清理批量更新定时器
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
  async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    if (!this.transport.isConnected()) {
      const connected = await this.connect();
      if (!connected) {
        throw new AppError(`Failed to connect to MCP server ${this.name}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
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
  async batchSendRequests(requests: MCPRequest[]): Promise<MCPResponse[]> {
    if (requests.length === 0) {
      return [];
    }

    if (requests.length === 1) {
      return [await this.sendRequest(requests[0])];
    }

    // 收集所有请求的Promise
    const responsePromises = requests.map((request) => {
      return this.sendRequest(request);
    });

    return Promise.all(responsePromises);
  }

  /**
   * 添加到批量更新队列
   */
  queueBatchRequest(request: MCPRequest): Promise<MCPResponse> {
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

    // 尝试重连
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  /**
   * 调用工具
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    const request: MCPRequest = {
      id: randomUUID(),
      type: 'call',
      tool_name: toolName,
      args,
    };

    const response = await this.sendRequest(request);

    if (response.type === 'error') {
      throw new AppError(response.error?.message || 'Tool call failed', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    return response.result;
  }

  /**
   * 刷新工具列表
   */
  async refreshTools(): Promise<MCPToolDefinition[]> {
    const request: MCPRequest = {
      id: randomUUID(),
      type: 'list_tools',
    };

    const response = await this.sendRequest(request);

    if (response.type === 'error') {
      throw new AppError(response.error?.message || 'Failed to list tools', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    this.tools = response.tools || [];
    return this.tools;
  }

  /**
   * 批量刷新工具列表（用于多个服务器）
   */
  static async batchRefreshTools(
    connections: MCPServerConnection[]
  ): Promise<Map<string, MCPToolDefinition[]>> {
    const result = new Map<string, MCPToolDefinition[]>();
    const refreshPromises = connections.map(async (connection) => {
      try {
        if (connection.isConnected()) {
          const tools = await connection.refreshTools();
          result.set(connection.getName(), tools);
        }
      } catch (error) {
        logger.error(
          `Failed to refresh tools for server ${connection.getName()}:`,
          error as Error
        );
      }
    });

    await Promise.all(refreshPromises);
    return result;
  }

  /**
   * 获取工具列表
   */
  getTools(): MCPToolDefinition[] {
    return this.tools;
  }

  /**
   * 获取服务器名称
   */
  getName(): string {
    return this.name;
  }

  /**
   * 获取服务器配置
   */
  getConfig(): MCPServerConfig {
    return this.config;
  }

  /**
   * 获取服务器状态
   */
  getStatus(): MCPServerStatus {
    return this.status;
  }

  /**
   * 设置服务器状态
   */
  setStatus(status: MCPServerStatus): void {
    this.status = status;
  }

  /**
   * 获取错误信息
   */
  getError(): string | undefined {
    return this.error;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.status === MCPServerStatus.CONNECTED;
  }

  /**
   * 发送ping请求检查服务器健康状态
   */
  async ping(): Promise<boolean> {
    const request: MCPRequest = {
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

  /**
   * 获取重连尝试次数
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * 获取最后连接时间
   */
  getLastConnectedTime(): number {
    return this.lastConnectedTime;
  }

  /**
   * 检查是否正在重连
   */
  isReconnecting(): boolean {
    return (
      this.reconnectAttempts > 0 && this.status !== MCPServerStatus.CONNECTED
    );
  }

  /**
   * 重置重连计数器
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}
