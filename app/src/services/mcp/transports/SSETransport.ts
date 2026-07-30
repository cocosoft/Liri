/**
 * SSE传输层
 * 基于服务器发送事件的传输方式
 */

import type { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { McpTlsConfig } from './McpTlsManager';

const logger = new Logger({
  module: 'services:mcp:sseTransport',
  level: LogLevel.INFO,
});

/**
 * SSE传输层选项
 */
interface SSETransportOptions {
  /** URL */
  url: string;
  /** 头部信息 */
  headers?: Record<string, string>;
  /** TLS 配置 */
  tls?: Partial<McpTlsConfig>;
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
    super(options.tls);
    this.url = options.url;
    this.headers = options.headers || {};
  }

  /**
   * 连接
   */
  override async connect(): Promise<void> {
    if (this.eventSource) {
      return;
    }

    const tlsOptions = this.tlsManager.createClientOptions();
    const sseUrl = tlsOptions ? this.url.replace(/^http:/, 'https:') : this.url;

    // 创建EventSource
    this.eventSource = new EventSource(sseUrl, {
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
        handleError(error, {
          module: 'services:mcp:sse',
          action: '解析SSE响应失败',
        });
      }
    });

    // 处理错误事件
    this.eventSource.addEventListener('error', (event) => {
      handleError(new Error('SSE error'), {
        module: 'services:mcp:sse',
        action: 'SSE连接错误',
      });
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
  override disconnect(): void {
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
      throw new AppError(
        'Not connected to MCP server',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 注意：SSE是单向的，只能从服务器到客户端
    // 这里需要通过HTTP POST发送请求
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });

      const tlsOptions = this.tlsManager.createFetchAgentOptions();

      // 通过HTTP POST发送请求
      fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(request),
        ...(tlsOptions ? { tls: tlsOptions } : {}),
      }).catch((error) => {
        reject(error);
        this.pendingRequests.delete(request.id);
      });
    });
  }
}
