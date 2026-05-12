/**
 * HTTP传输层
 * 基于HTTP的传输方式
 */

import { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * HTTP传输层选项
 */
interface HTTPTransportOptions {
  /** URL */
  url: string;
  /** 头部信息 */
  headers?: Record<string, string>;
}

/**
 * HTTP传输层
 */
export class HTTPTransport extends MCPTransport {
  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(options: HTTPTransportOptions) {
    super();
    this.url = options.url;
    this.headers = options.headers || {};
  }

  /**
   * 连接
   * HTTP传输层不需要持久连接，直接返回成功
   */
  override async connect(): Promise<void> {
    await super.connect();
  }

  /**
   * 发送请求
   */
  async send(request: MCPRequest): Promise<MCPResponse> {
    if (!this.connected) {
      throw new AppError('Not connected to MCP server', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new AppError(`HTTP error: ${response.status} ${response.statusText}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    const data = await response.json();
    return data as MCPResponse;
  }
}
