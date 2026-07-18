//
/**
 * 远程Agent通信协议实现
 */

import {
  RemoteAgentProtocol,
  ProtocolType,
  ProtocolOptions,
  RemoteAgentTask,
  RemoteExecutionResult,
} from './types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'agent\remote\RemoteAgentProtocol', level: LogLevel.INFO });

const DEFAULT_OPTIONS: ProtocolOptions = {
  timeout: 30000,
  retryCount: 3,
};

export class WebSocketProtocol implements RemoteAgentProtocol {
  type: ProtocolType = 'websocket';
  private socket: WebSocket | null = null;
  private options: ProtocolOptions;
  private url: string = '';

  constructor(options: ProtocolOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async connect(url: string): Promise<void> {
    this.url = url;
    return new Promise((resolve, reject) => {
      const wsUrl = url
        .replace('http://', 'ws://')
        .replace('https://', 'wss://');
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        resolve();
      };

      this.socket.onerror = (error) => {
        reject(error);
      };

      this.socket.onclose = () => {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection closed'));
        }
      };

      // 设置连接超时
      setTimeout(() => {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          this.socket?.close();
          reject(new Error('Connection timeout'));
        }
      }, this.options.timeout);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  async send(data: RemoteAgentTask): Promise<RemoteExecutionResult> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new AppError(
        'Not connected to remote agent',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const socket = this.socket;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const messageId = `${data.id}_${Date.now()}`;

      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, data.timeoutMs || this.options.timeout);

      const handleMessage = (event: MessageEvent) => {
        try {
          const result: RemoteExecutionResult = JSON.parse(event.data);
          if (result.taskId === data.id) {
            clearTimeout(timeout);
            socket.removeEventListener('message', handleMessage);

            result.durationMs = Date.now() - startTime;
            resolve(result);
          }
        } catch (error) {
          clearTimeout(timeout);
          socket.removeEventListener('message', handleMessage);
          reject(error);
        }
      };

      socket.addEventListener('message', handleMessage);

      socket.send(
        JSON.stringify({
          ...data,
          messageId,
        })
      );
    });
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

export class HttpProtocol implements RemoteAgentProtocol {
  type: ProtocolType = 'http';
  private options: ProtocolOptions;

  constructor(options: ProtocolOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async connect(url: string): Promise<void> {
    // HTTP协议不需要持久连接
  }

  disconnect(): void {
    // HTTP协议不需要断开连接
  }

  async send(data: RemoteAgentTask): Promise<RemoteExecutionResult> {
    const startTime = Date.now();
    const timeoutValue = data.timeoutMs ?? this.options.timeout;
    const timeoutMs = timeoutValue ?? 30000;
    const retryCount = this.options.retryCount ?? 3;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        const response = await fetch(`/api/agents/${data.agentId}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.options.headers ?? {}),
          },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          throw new AppError(
            `HTTP error: ${response.status}`,
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            '1000'
          );
        }

        const result: RemoteExecutionResult = await response.json();
        result.durationMs = Date.now() - startTime;

        return result;
      } catch (error) {
        if (attempt === retryCount) {
          throw error;
        }

        // 指数退避等待
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
      }
    }

    throw new AppError(
      'Max retries exceeded',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  isConnected(): boolean {
    return true;
  }
}
