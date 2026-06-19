/**
 * 提供与MCP服务器的连接、工具调用、资源管理等核心功能
 */

import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type {
  MCPClient,
  MCPRequest,
  MCPResponse,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPPromptDefinition,
  MCPServerInfo,
  MCPConnectionStats,
  MCPEvent,
  MCPEventType,
  MCPClientState,
  MCPTransport,
} from '../types/MCPTypes';

const logger = new Logger({ level: LogLevel.INFO });

export class MCPClientImpl extends EventEmitter implements MCPClient {
  private transport: MCPTransport;
  private _state: MCPClientState = 'disconnected';
  private _stats: MCPConnectionStats;
  private requestIdCounter = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  /**
   * 构造函数
   */
  constructor(transport: MCPTransport) {
    super();
    this.transport = transport;
    this._stats = this.createInitialStats();

    // 监听传输层事件
    this.setupTransportListeners();
  }

  /**
   * 连接服务器
   */
  async connect(): Promise<void> {
    if (this._state !== 'disconnected') {
      throw new AppError(
        `Cannot connect from state: ${this._state}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1006'
      );
    }

    try {
      this.setState('connecting');

      // 建立传输层连接
      await this.transport.connect();

      // 发送初始化请求
      await this.sendInitialHandshake();

      this.setState('connected');
      this.emitEvent('connect', { serverName: this.transport.name });

      // 开始心跳检测
      this.startHeartbeat();
    } catch (error) {
      this.setState('error');
      this.emitEvent('error', {
        serverName: this.transport.name,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this._state === 'disconnected') {
      return;
    }

    try {
      this.setState('disconnecting');

      // 停止心跳检测
      this.stopHeartbeat();

      // 关闭传输层连接
      await this.transport.close();

      // 清理挂起的请求
      this.cleanupPendingRequests();

      this.setState('disconnected');
      this.emitEvent('disconnect', { serverName: this.transport.name });
    } catch (error) {
      this.setState('error');
      this.emitEvent('error', {
        serverName: this.transport.name,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 调用工具
   */
  async callTool(
    name: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    if (this._state !== 'connected') {
      throw new AppError(
        `Cannot call tool from state: ${this._state}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1006'
      );
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'call',
      tool_name: name,
      tool_arguments: args,
    };

    const startTime = Date.now();

    try {
      const result = await this.sendRequest(request);

      // 更新统计信息
      this.updateStats('toolCalls', Date.now() - startTime);
      this.emitEvent('tool_call', {
        serverName: this.transport.name,
        toolName: name,
        arguments,
        result,
      });

      return result;
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', {
        serverName: this.transport.name,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 列出工具
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    if (this._state !== 'connected') {
      throw new AppError(
        `Cannot list tools from state: ${this._state}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1006'
      );
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'list_tools',
    };

    const startTime = Date.now();

    try {
      const result = (await this.sendRequest(request)) as Record<
        string,
        unknown
      >;

      // 更新统计信息
      this.updateStats('toolCalls', Date.now() - startTime);

      return (result.tools as MCPToolDefinition[]) || [];
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', {
        serverName: this.transport.name,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 列出资源
   */
  async listResources(): Promise<MCPResourceDefinition[]> {
    if (this._state !== 'connected') {
      throw new AppError(
        `Cannot list resources from state: ${this._state}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1006'
      );
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'list_resources',
    };

    const startTime = Date.now();

    try {
      const result = (await this.sendRequest(request)) as Record<
        string,
        unknown
      >;

      // 更新统计信息
      this.updateStats('resourceReads', Date.now() - startTime);

      return (result.resources as MCPResourceDefinition[]) || [];
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', {
        serverName: this.transport.name,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 列出提示
   */
  async listPrompts(): Promise<MCPPromptDefinition[]> {
    if (this._state !== 'connected') {
      throw new AppError(
        `Cannot list prompts from state: ${this._state}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1006'
      );
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'list_prompts',
    };

    const startTime = Date.now();

    try {
      const result = (await this.sendRequest(request)) as Record<
        string,
        unknown
      >;

      // 更新统计信息
      this.updateStats('promptGets', Date.now() - startTime);

      return (result.prompts as MCPPromptDefinition[]) || [];
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', {
        serverName: this.transport.name,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 获取服务器信息
   */
  async getServerInfo(): Promise<MCPServerInfo> {
    if (this._state !== 'connected') {
      throw new AppError(
        `Cannot get server info from state: ${this._state}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1006'
      );
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'ping',
    };

    const startTime = Date.now();

    try {
      const result = (await this.sendRequest(request)) as Record<
        string,
        unknown
      >;

      // 更新统计信息
      this.updateStats('toolCalls', Date.now() - startTime);

      return {
        name: (result.name as string) || 'unknown',
        version: (result.version as string) || '1.0.0',
        capabilities: (result.capabilities as Record<string, boolean>) || {},
      };
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', {
        serverName: this.transport.name,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 获取连接状态
   */
  getState(): MCPClientState {
    return this._state;
  }

  /**
   * 获取连接统计
   */
  getStats(): MCPConnectionStats {
    return { ...this._stats };
  }

  /**
   * 发送请求
   */
  private async sendRequest(request: MCPRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout: ${request.id}`));
      }, 30000); // 30秒超时

      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout,
      });

      this.transport.send(request).catch(reject);
    });
  }

  /**
   * 处理响应
   */
  private handleResponse(response: MCPResponse): void {
    const pendingRequest = this.pendingRequests.get(response.request_id);

    if (!pendingRequest) {
      logger.warning(
        `Received response for unknown request: ${response.request_id}`
      );
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingRequests.delete(response.request_id);

    if (response.type === 'result') {
      pendingRequest.resolve(response.result);
    } else if (response.type === 'error') {
      const error = new Error(response.error?.message || 'Unknown error');
      (error as any).code = response.error?.code;
      pendingRequest.reject(error);
    } else if (response.type === 'progress') {
      // 处理进度更新
      this.emit('progress', response.progress);
    }
  }

  /**
   * 设置传输层监听器
   */
  private setupTransportListeners(): void {
    // 监听响应
    (async () => {
      for await (const response of this.transport.receive()) {
        this.handleResponse(response);
      }
    })();

    // 监听状态变化
    this.transport.on('stateChange', (state: unknown) => {
      this.setState(state as MCPClientState);
    });

    // 监听错误
    this.transport.on('error', (error: unknown) => {
      this.emitEvent('error', {
        serverName: this.transport.name,
        error: error as Error,
      });
    });
  }

  /**
   * 发送初始化握手
   */
  private async sendInitialHandshake(): Promise<void> {
    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'ping',
    };

    await this.sendRequest(request);
  }

  /**
   * 开始心跳检测
   */
  private startHeartbeat(): void {
    // 心跳检测逻辑
    const heartbeatInterval = setInterval(async () => {
      if (this._state !== 'connected') {
        clearInterval(heartbeatInterval);
        return;
      }

      try {
        await this.getServerInfo();
      } catch (error) {
        logger.warning('Heartbeat failed:', { error });
      }
    }, 30000); // 30秒心跳
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    // 清理心跳定时器
  }

  /**
   * 设置连接状态
   */
  private setState(newState: MCPClientState): void {
    if (this._state !== newState) {
      const oldState = this._state;
      this._state = newState;

      this.emitEvent('state_change', {
        serverName: this.transport.name,
        oldState,
        newState,
      });
    }
  }

  /**
   * 发射事件
   */
  private emitEvent(type: MCPEventType, data?: any): void {
    const event: MCPEvent = {
      type,
      data,
      timestamp: new Date(),
      serverName: this.transport.name || 'unknown',
    };

    this.emit('event', event);
    this.emit(type, event);
  }

  /**
   * 更新统计信息
   */
  private updateStats(type: keyof MCPConnectionStats, duration?: number): void {
    this._stats.lastActivity = new Date();

    switch (type) {
      case 'toolCalls':
        this._stats.toolCalls++;
        break;
      case 'resourceReads':
        this._stats.resourceReads++;
        break;
      case 'promptGets':
        this._stats.promptGets++;
        break;
      case 'errors':
        this._stats.errors++;
        break;
    }

    if (duration !== undefined) {
      // 更新平均响应时间
      const totalTime =
        this._stats.averageResponseTime *
        (this._stats.toolCalls +
          this._stats.resourceReads +
          this._stats.promptGets -
          1);
      this._stats.averageResponseTime =
        (totalTime + duration) /
        (this._stats.toolCalls +
          this._stats.resourceReads +
          this._stats.promptGets);
    }
  }

  /**
   * 清理挂起的请求
   */
  private cleanupPendingRequests(): void {
    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 生成请求ID
   */
  private generateRequestId(): string {
    return `req_${++this.requestIdCounter}_${Date.now()}`;
  }

  /**
   * 创建初始统计信息
   */
  private createInitialStats(): MCPConnectionStats {
    const now = new Date();
    return {
      connectedAt: now,
      toolCalls: 0,
      resourceReads: 0,
      promptGets: 0,
      errors: 0,
      lastActivity: now,
      averageResponseTime: 0,
    };
  }

  // 实现接口属性
  get state(): MCPClientState {
    return this._state;
  }

  get stats(): MCPConnectionStats {
    return this._stats;
  }
}

export default MCPClientImpl;
