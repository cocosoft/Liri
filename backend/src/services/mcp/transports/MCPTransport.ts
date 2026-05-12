/**
 * MCP传输层基础类
 */

import {
  MCPRequest,
  MCPResponse,
  MCPClientState,
  MCPTransport as IMCPTransport,
} from '../types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * MCP传输层基础类
 * 具体传输实现（Stdio, HTTP, WebSocket等）在增强层中
 */
export abstract class MCPTransport implements IMCPTransport {
  /** 连接状态 */
  protected connected: boolean = false;
  protected _state: MCPClientState = 'disconnected';

  /**
   * 发送请求
   */
  abstract send(request: MCPRequest): Promise<MCPResponse>;

  /**
   * 连接
   */
  async connect(): Promise<void> {
    this.connected = true;
    this._state = 'connected';
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.connected = false;
    this._state = 'disconnected';
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    this.disconnect();
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 获取连接状态
   */
  get state(): MCPClientState {
    return this._state;
  }

  /**
   * 接收响应（子类可重写）
   */
  receive(): AsyncIterable<MCPResponse> {
    throw new AppError(
      'receive() not implemented by this transport',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  /**
   * 事件监听（子类可重写）
   */
  on(_event: string, _listener: (...args: unknown[]) => void): void {
    // 子类可重写以实现具体的事件监听逻辑
  }
}
