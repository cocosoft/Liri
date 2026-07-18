/**
 * HTTP传输层
 * 基于HTTP POST的传输方式
 */

import type { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { McpTlsConfig } from './McpTlsManager';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'services\mcp\transports\HTTPTransport', level: LogLevel.INFO });

interface HTTPTransportOptions {
  url: string;
  headers?: Record<string, string>;
  tls?: Partial<McpTlsConfig>;
}

export class HTTPTransport extends MCPTransport {
  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(options: HTTPTransportOptions) {
    super(options.tls);
    this.url = options.url;
    this.headers = options.headers || {};
  }

  override async connect(): Promise<void> {
    await super.connect();
  }

  async send(request: MCPRequest): Promise<MCPResponse> {
    if (!this.connected) {
      throw new AppError(
        'Not connected to MCP server',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const tlsOptions = this.tlsManager.createFetchAgentOptions();

    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(request),
      ...(tlsOptions ? { tls: tlsOptions } : {}),
    });

    if (!response.ok) {
      throw new AppError(
        `HTTP error: ${response.status} ${response.statusText}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const data = await response.json();
    return data as MCPResponse;
  }
}
