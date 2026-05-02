/**
 * MCP客户端实现（基于CC源码实现）
 * 提供与MCP服务器的连接、工具调用、资源管理等核心功能
 */

import { EventEmitter } from 'events';
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
  MCPTransport
} from '../types/MCPTypes';

/**
 * MCP客户端类（基于CC源码实现）
 */
export class MCPClientImpl extends EventEmitter implements MCPClient {
  private transport: MCPTransport;
  private state: MCPClientState = 'disconnected';
  private stats: MCPConnectionStats;
  private requestIdCounter = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  /**
   * 构造函数（基于CC源码）
   */
  constructor(transport: MCPTransport) {
    super();
    this.transport = transport;
    this.stats = this.createInitialStats();
    
    // 监听传输层事件
    this.setupTransportListeners();
  }

  /**
   * 连接服务器（基于CC源码）
   */
  async connect(): Promise<void> {
    if (this.state !== 'disconnected') {
      throw new Error(`Cannot connect from state: ${this.state}`);
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
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      throw error;
    }
  }

  /**
   * 断开连接（基于CC源码）
   */
  async disconnect(): Promise<void> {
    if (this.state === 'disconnected') {
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
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      throw error;
    }
  }

  /**
   * 调用工具（基于CC源码）
   */
  async callTool(name: string, args?: Record<string, any>): Promise<any> {
    if (this.state !== 'connected') {
      throw new Error(`Cannot call tool from state: ${this.state}`);
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
        result 
      });
      
      return result;
      
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', { 
        serverName: this.transport.name, 
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      throw error;
    }
  }

  /**
   * 列出工具（基于CC源码）
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    if (this.state !== 'connected') {
      throw new Error(`Cannot list tools from state: ${this.state}`);
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'list_tools',
    };

    const startTime = Date.now();
    
    try {
      const result = await this.sendRequest(request);
      
      // 更新统计信息
      this.updateStats('toolCalls', Date.now() - startTime);
      
      return result.tools || [];
      
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', { 
        serverName: this.transport.name, 
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      throw error;
    }
  }

  /**
   * 列出资源（基于CC源码）
   */
  async listResources(): Promise<MCPResourceDefinition[]> {
    if (this.state !== 'connected') {
      throw new Error(`Cannot list resources from state: ${this.state}`);
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'list_resources',
    };

    const startTime = Date.now();
    
    try {
      const result = await this.sendRequest(request);
      
      // 更新统计信息
      this.updateStats('resourceReads', Date.now() - startTime);
      
      return result.resources || [];
      
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', { 
        serverName: this.transport.name, 
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      throw error;
    }
  }

  /**
   * 列出提示（基于CC源码）
   */
  async listPrompts(): Promise<MCPPromptDefinition[]> {
    if (this.state !== 'connected') {
      throw new Error(`Cannot list prompts from state: ${this.state}`);
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'list_prompts',
    };

    const startTime = Date.now();
    
    try {
      const result = await this.sendRequest(request);
      
      // 更新统计信息
      this.updateStats('promptGets', Date.now() - startTime);
      
      return result.prompts || [];
      
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', { 
        serverName: this.transport.name, 
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      throw error;
    }
  }

  /**
   * 获取服务器信息（基于CC源码）
   */
  async getServerInfo(): Promise<MCPServerInfo> {
    if (this.state !== 'connected') {
      throw new Error(`Cannot get server info from state: ${this.state}`);
    }

    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'ping',
    };

    const startTime = Date.now();
    
    try {
      const result = await this.sendRequest(request);
      
      // 更新统计信息
      this.updateStats('toolCalls', Date.now() - startTime);
      
      return {
        name: result.name || 'unknown',
        version: result.version || '1.0.0',
        capabilities: result.capabilities || {},
      };
      
    } catch (error) {
      this.updateStats('errors');
      this.emitEvent('error', { 
        serverName: this.transport.name, 
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      throw error;
    }
  }

  /**
   * 获取连接状态（基于CC源码）
   */
  getState(): MCPClientState {
    return this.state;
  }

  /**
   * 获取连接统计（基于CC源码）
   */
  getStats(): MCPConnectionStats {
    return { ...this.stats };
  }

  /**
   * 发送请求（基于CC源码）
   */
  private async sendRequest(request: MCPRequest): Promise<any> {
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
   * 处理响应（基于CC源码）
   */
  private handleResponse(response: MCPResponse): void {
    const pendingRequest = this.pendingRequests.get(response.request_id);
    
    if (!pendingRequest) {
      console.warn(`Received response for unknown request: ${response.request_id}`);
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
   * 设置传输层监听器（基于CC源码）
   */
  private setupTransportListeners(): void {
    // 监听响应
    (async () => {
      for await (const response of this.transport.receive()) {
        this.handleResponse(response);
      }
    })();

    // 监听状态变化
    this.transport.on('stateChange', (state: MCPClientState) => {
      this.setState(state);
    });

    // 监听错误
    this.transport.on('error', (error: Error) => {
      this.emitEvent('error', { 
        serverName: this.transport.name, 
        error 
      });
    });
  }

  /**
   * 发送初始化握手（基于CC源码）
   */
  private async sendInitialHandshake(): Promise<void> {
    const request: MCPRequest = {
      id: this.generateRequestId(),
      type: 'ping',
    };

    await this.sendRequest(request);
  }

  /**
   * 开始心跳检测（基于CC源码）
   */
  private startHeartbeat(): void {
    // 心跳检测逻辑
    const heartbeatInterval = setInterval(async () => {
      if (this.state !== 'connected') {
        clearInterval(heartbeatInterval);
        return;
      }

      try {
        await this.getServerInfo();
      } catch (error) {
        console.warn('Heartbeat failed:', error);
      }
    }, 30000); // 30秒心跳
  }

  /**
   * 停止心跳检测（基于CC源码）
   */
  private stopHeartbeat(): void {
    // 清理心跳定时器
  }

  /**
   * 设置连接状态（基于CC源码）
   */
  private setState(newState: MCPClientState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      
      this.emitEvent('state_change', { 
        serverName: this.transport.name, 
        oldState, 
        newState 
      });
    }
  }

  /**
   * 发射事件（基于CC源码）
   */
  private emitEvent(type: MCPEventType, data?: any): void {
    const event: MCPEvent = {
      type,
      data,
      timestamp: new Date(),
      serverName: this.transport.name,
    };
    
    this.emit('event', event);
    this.emit(type, event);
  }

  /**
   * 更新统计信息（基于CC源码）
   */
  private updateStats(type: keyof MCPConnectionStats, duration?: number): void {
    this.stats.lastActivity = new Date();
    
    switch (type) {
      case 'toolCalls':
        this.stats.toolCalls++;
        break;
      case 'resourceReads':
        this.stats.resourceReads++;
        break;
      case 'promptGets':
        this.stats.promptGets++;
        break;
      case 'errors':
        this.stats.errors++;
        break;
    }

    if (duration !== undefined) {
      // 更新平均响应时间
      const totalTime = this.stats.averageResponseTime * (this.stats.toolCalls + this.stats.resourceReads + this.stats.promptGets - 1);
      this.stats.averageResponseTime = (totalTime + duration) / (this.stats.toolCalls + this.stats.resourceReads + this.stats.promptGets);
    }
  }

  /**
   * 清理挂起的请求（基于CC源码）
   */
  private cleanupPendingRequests(): void {
    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 生成请求ID（基于CC源码）
   */
  private generateRequestId(): string {
    return `req_${++this.requestIdCounter}_${Date.now()}`;
  }

  /**
   * 创建初始统计信息（基于CC源码）
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
    return this.state;
  }

  get stats(): MCPConnectionStats {
    return this.stats;
  }
}

export default MCPClientImpl;