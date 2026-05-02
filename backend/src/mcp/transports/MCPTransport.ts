/**
 * MCP传输层基础类
 */

import {
  MCPRequest,
  MCPResponse,
  MCPTransport as IMCPTransport,
} from '../types';

/**
 * MCP传输层基础类
 */
export abstract class MCPTransport implements IMCPTransport {
  /** 连接状态 */
  protected connected: boolean = false;

  /**
   * 发送请求
   */
  abstract send(request: MCPRequest): Promise<MCPResponse>;

  /**
   * 连接
   */
  async connect(): Promise<void> {
    this.connected = true;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.connected = false;
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.connected;
  }
}
