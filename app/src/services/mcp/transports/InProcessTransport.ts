/**
 * 进程内传输
 * 支持同一进程内MCP通信，无需序列化
 */

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services\mcp\transports\InProcessTransport',
  level: LogLevel.INFO,
});

/**
 * 进程内传输接口
 */
export interface InProcessTransportInterface {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
}

/**
 * 进程内传输实现
 * 用于内置MCP服务器和测试场景
 */
class InProcessTransportImpl implements InProcessTransportInterface {
  private peer: InProcessTransportImpl | undefined;
  private _closed = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  _setPeer(peer: InProcessTransportImpl): void {
    this.peer = peer;
  }

  async start(): Promise<void> {
    // 无需实际操作
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      throw new AppError(
        'Transport is closed',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 异步投递消息，避免同步请求/响应循环导致的栈溢出
    queueMicrotask(() => {
      this.peer?.onmessage?.(message);
    });
  }

  async close(): Promise<void> {
    if (this._closed) {
      return;
    }

    this._closed = true;
    this.onclose?.();

    // 关闭对端
    if (this.peer && !this.peer._closed) {
      this.peer._closed = true;
      this.peer.onclose?.();
    }
  }

  get _isClosed(): boolean {
    return this._closed;
  }
}

/**
 * 创建链接的传输对
 * 在一个传输上发送的消息会投递到另一个传输的onmessage
 *
 * @returns [客户端传输, 服务端传输]
 */
export function createLinkedTransportPair(): [
  InProcessTransportInterface,
  InProcessTransportInterface,
] {
  const client = new InProcessTransportImpl();
  const server = new InProcessTransportImpl();

  client._setPeer(server);
  server._setPeer(client);

  return [client, server];
}

/**
 * 进程内传输工厂
 */
export class InProcessTransportFactory {
  private transports: Map<string, InProcessTransportImpl> = new Map();

  /**
   * 创建传输对
   */
  createPair(connectionId: string): {
    client: InProcessTransportInterface;
    server: InProcessTransportInterface;
  } {
    const [client, server] = createLinkedTransportPair();

    this.transports.set(
      `${connectionId}:client`,
      client as InProcessTransportImpl
    );
    this.transports.set(
      `${connectionId}:server`,
      server as InProcessTransportImpl
    );

    return { client, server };
  }

  /**
   * 获取传输
   */
  getTransport(
    connectionId: string,
    side: 'client' | 'server'
  ): InProcessTransportInterface | undefined {
    return this.transports.get(`${connectionId}:${side}`);
  }

  /**
   * 关闭传输
   */
  async closeTransport(
    connectionId: string,
    side: 'client' | 'server'
  ): Promise<void> {
    const transport = this.transports.get(`${connectionId}:${side}`);
    if (transport) {
      await transport.close();
      this.transports.delete(`${connectionId}:${side}`);
    }
  }

  /**
   * 关闭所有传输
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];
    const transportsArray = Array.from(this.transports.values());

    for (const transport of transportsArray) {
      closePromises.push(transport.close());
    }

    await Promise.all(closePromises);
    this.transports.clear();
  }
}

/**
 * 导出单例
 */
export const inProcessTransportFactory = new InProcessTransportFactory();
