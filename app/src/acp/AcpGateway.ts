// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * AcpGateway — ACP 网关
 *
 * 管理远程客户端注册、路由，将远程消息桥接到 AcpRuntime。
 */

import type { AcpServerOptions, SessionId } from './types.js';
import type { AcpRuntime } from './runtime/types.js';
import type { AcpSessionStore } from './session.js';

/**
 * 服务端连接接口
 */
export interface AgentSideConnection {
  send(event: string, data: unknown): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): void;
}

/**
 * 网关客户端信息
 */
export interface GatewayClient {
  id: string;
  connectedAt: number;
  sessionId?: SessionId;
  connection: AgentSideConnection;
}

/**
 * ACP 网关
 *
 * 管理远程客户端注册与分发，将远程消息桥接到 AcpRuntime。
 */
export class AcpGateway {
  private clients: Map<string, GatewayClient> = new Map();
  private runtime: AcpRuntime;
  private sessionStore: AcpSessionStore;
  private options: AcpServerOptions;

  constructor(
    runtime: AcpRuntime,
    sessionStore: AcpSessionStore,
    options: AcpServerOptions = {}
  ) {
    this.runtime = runtime;
    this.sessionStore = sessionStore;
    this.options = options;
  }

  /**
   * 获取客户端
   */
  getClient(clientId: string): GatewayClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * 列出所有客户端
   */
  listClients(): GatewayClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * 注册客户端
   */
  registerClient(client: GatewayClient): void {
    this.clients.set(client.id, client);
  }

  /**
   * 注销客户端
   */
  unregisterClient(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  /**
   * 获取运行时
   */
  getRuntime(): AcpRuntime {
    return this.runtime;
  }

  /**
   * 获取会话存储
   */
  getSessionStore(): AcpSessionStore {
    return this.sessionStore;
  }

  /**
   * 获取配置选项
   */
  getOptions(): AcpServerOptions {
    return this.options;
  }
}

/**
 * 创建 ACP 网关
 */
export function createAcpGateway(
  runtime: AcpRuntime,
  sessionStore: AcpSessionStore,
  options?: AcpServerOptions
): AcpGateway {
  return new AcpGateway(runtime, sessionStore, options);
}
