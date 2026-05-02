/**
 * SSE传输层
 * 基于服务器发送事件的传输方式
 */

import { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';

/**
 * SSE传输层选项
 */
interface SSETransportOptions {
  /** URL */
  url: string;
  /** 头部信息 */
  headers?: Record<string, string>;
}

/**
 * SSE传输层
 */
export class SSETransport extends MCPTransport {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private eventSource: EventSource | null = null;
  private pendingRequests: Map<
    string,
    { resolve: (response: MCPResponse) => void; reject: (error: Error) => void }
  > = new Map();

  constructor(options: SSETransportOptions) {
    super();
    this.url = options.url;
    this.headers = options.headers || {};
  }

  /**
   * 连接
   */
  async connect(): Promise<void> {
    if (this.eventSource) {
      return;
    }

    // 创建EventSource
    this.eventSource = new EventSource(this.url, {
      withCredentials: true,
    });

    // 处理消息事件
    this.eventSource.addEventListener('message', (event) => {
      try {
        const response: MCPResponse = JSON.parse(event.data);
        const requestId = response.id;
        const pendingRequest = this.pendingRequests.get(requestId);

        if (pendingRequest) {
          pendingRequest.resolve(response);
          this.pendingRequests.delete(requestId);
        }
      } catch (error) {
        console.error(`Failed to parse SSE response: ${event.data}`);
      }
    });

    // 处理错误事件
    this.eventSource.addEventListener('error', (event) => {
      console.error('SSE error:', event);
      this.connected = false;

      // 拒绝所有未完成的请求
      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error('SSE connection error'));
      }
      this.pendingRequests.clear();
    });

    await super.connect();
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    super.disconnect();
  }

  /**
   * 发送请求
   */
  async send(request: MCPRequest): Promise<MCPResponse> {
    if (!this.eventSource || !this.connected) {
      throw new Error('Not connected to MCP server');
    }

    // 注意：SSE是单向的，只能从服务器到客户端
    // 这里需要通过HTTP POST发送请求
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });

      // 通过HTTP POST发送请求
      fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(request),
      }).catch((error) => {
        reject(error);
        this.pendingRequests.delete(request.id);
      });
    });
  }
}
