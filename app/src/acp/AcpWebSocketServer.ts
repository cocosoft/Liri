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
 * AcpWebSocketServer — ACP WebSocket 远程桥接服务器
 *
 * 基于 Node.js 内置 http + net 模块实现 RFC 6455 WebSocket 服务器，
 * 无需第三方依赖。接受远程 ACP 客户端连接，将消息路由到 AcpRuntime。
 */

import type { AcpServerOptions, AcpWebSocketServerConfig } from './types.js';
import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeSessionMode,
  AcpRuntimePromptMode,
} from './runtime/types.js';
import { getDefaultSessionStore } from './session.js';
import type { AcpSessionStore } from './session.js';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import * as http from 'http';
import * as net from 'net';
import type { Duplex } from 'stream';
import * as crypto from 'crypto';
import { computeAcceptHash } from './websocket.js';
import { AcpWsClient } from './AcpWsClient.js';
import type { AcpClientMessage } from './AcpWsClient.js';
import { AcpGateway } from './AcpGateway.js';

const logger = new Logger({ module: 'acp:ws', level: LogLevel.INFO });

/**
 * ACP WebSocket 远程桥接服务器
 */
export class AcpWebSocketServer {
  readonly name = 'acp-remote-bridge';

  private httpServer: http.Server | null = null;
  private clients: Map<string, AcpWsClient> = new Map();
  private gateway: AcpGateway;
  private config: AcpWebSocketServerConfig;
  private started = false;

  constructor(
    runtime: AcpRuntime,
    config: AcpWebSocketServerConfig,
    sessionStore?: AcpSessionStore,
    options?: AcpServerOptions
  ) {
    this.gateway = new AcpGateway(
      runtime,
      sessionStore || getDefaultSessionStore(),
      options
    );
    this.config = {
      host: '127.0.0.1',
      path: '/acp',
      maxMessageSize: 1 * 1024 * 1024,
      ...config,
    };
  }

  /**
   * 启动 ACP WebSocket 服务器
   */
  async start(): Promise<void> {
    if (this.started) return;

    if (this.config.port === 0) {
      logger.info('[ACP] 远程桥接已禁用（port=0）');
      this.started = true;
      return;
    }

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        if (req.url === this.config.path) {
          res.writeHead(426, { 'Content-Type': 'text/plain' });
          res.end('This endpoint requires WebSocket connection');
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.httpServer.on('upgrade', (req, socket, head) => {
        const url = req.url || '';

        if (url !== this.config.path) {
          socket.destroy();
          return;
        }

        if (!this.verifyUpgradeRequest(req)) {
          socket.write(
            'HTTP/1.1 401 Unauthorized\r\n' +
              'Content-Type: text/plain\r\n' +
              'Connection: close\r\n' +
              '\r\n' +
              'Unauthorized'
          );
          socket.destroy();
          return;
        }

        this.handleUpgrade(req, socket, head);
      });

      this.httpServer.on('error', (err) => {
        logger.error('[ACP] 服务器启动失败', err);
        reject(err);
      });

      this.httpServer.listen(this.config.port, this.config.host, () => {
        logger.info(
          `[ACP] 远程桥接服务器已启动: ws://${this.config.host}:${this.config.port}${this.config.path}`
        );
        this.started = true;
        resolve();
      });
    });
  }

  /**
   * 停止 ACP WebSocket 服务器
   */
  async stop(): Promise<void> {
    if (!this.started || !this.httpServer) return;

    for (const [, client] of this.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    return new Promise((resolve) => {
      this.httpServer!.close(() => {
        logger.info('[ACP] 远程桥接服务器已停止');
        this.httpServer = null;
        this.started = false;
        resolve();
      });
    });
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    if (this.config.port === 0) return true;
    return this.httpServer !== null && this.httpServer.listening;
  }

  /**
   * 获取当前已连接的客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 验证升级请求
   */
  private verifyUpgradeRequest(req: http.IncomingMessage): boolean {
    const upgrade = req.headers['upgrade'] || '';
    if (upgrade.toLowerCase() !== 'websocket') return false;

    if (this.config.authToken) {
      const auth = req.headers['authorization'] || '';
      if (auth !== `Bearer ${this.config.authToken}`) return false;
    }

    return true;
  }

  /**
   * 处理 WebSocket 升级握手
   */
  private handleUpgrade(
    req: http.IncomingMessage,
    socket: net.Socket | Duplex,
    head: Buffer
  ): void {
    const key = req.headers['sec-websocket-key'] as string;
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptHash = computeAcceptHash(key);

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptHash}`,
      '',
      '',
    ].join('\r\n');

    socket.write(responseHeaders);

    if (head.length > 0) {
      socket.write(head);
    }

    const clientId = crypto.randomUUID();
    const client = new AcpWsClient(clientId, socket, () => {
      this.clients.delete(clientId);
    });
    client.setMaxMessageSize(this.config.maxMessageSize || 1 * 1024 * 1024);

    this.clients.set(clientId, client);
    logger.info(`[ACP] 客户端已连接: ${clientId} (共 ${this.clients.size} 个)`);

    this.handleClientMessages(client);
  }

  /**
   * 处理客户端消息
   */
  private async handleClientMessages(client: AcpWsClient): Promise<void> {
    const otel = getOTelTracing();
    const span = otel.startSpan('AcpWebSocketServer.handleClientMessages', {
      'client.id': client.id,
    });

    try {
      const runtime = this.gateway.getRuntime();

      let currentHandle: AcpRuntimeHandle | null = null;

      client.onMessage(async (text) => {
        let message: AcpClientMessage;
        try {
          message = JSON.parse(text);
        } catch {
          client.send(
            JSON.stringify({
              type: 'error',
              requestId: 'unknown',
              payload: { message: '无效的 JSON 格式' },
            })
          );
          return;
        }

        const { type, requestId, payload } = message;
        const rid = requestId || crypto.randomUUID();

        if (type === 'ping') {
          client.send(
            JSON.stringify({
              type: 'pong',
              requestId: rid,
              payload: { timestamp: Date.now() },
            })
          );
          return;
        }

        if (type === 'ensure_session') {
          try {
            currentHandle = await runtime.ensureSession({
              sessionKey:
                (payload?.sessionKey as string) || crypto.randomUUID(),
              agent: (payload?.agent as string) || 'acp-remote-client',
              mode: (payload?.mode as AcpRuntimeSessionMode) || 'persistent',
              cwd: payload?.cwd as string | undefined,
            });
            client.send(
              JSON.stringify({
                type: 'event',
                requestId: rid,
                payload: { handle: currentHandle },
              })
            );
            client.send(
              JSON.stringify({
                type: 'done',
                requestId: rid,
                payload: { stopReason: 'success' },
              })
            );
          } catch (error) {
            await handleError(error, {
              module: 'acp:ws',
              action: 'ensureSession',
              rethrow: false,
            });
            client.send(
              JSON.stringify({
                type: 'error',
                requestId: rid,
                payload: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              })
            );
          }
          return;
        }

        if (type === 'run_turn') {
          if (!currentHandle) {
            client.send(
              JSON.stringify({
                type: 'error',
                requestId: rid,
                payload: { message: '会话未建立，请先调用 ensure_session' },
              })
            );
            return;
          }

          try {
            const iterable = runtime.runTurn({
              handle: currentHandle,
              text: (payload?.text as string) || '',
              mode: (payload?.mode as AcpRuntimePromptMode) || 'prompt',
              requestId: rid,
            });

            for await (const event of iterable) {
              switch (event.type) {
                case 'text_delta':
                  client.send(
                    JSON.stringify({
                      type: 'event',
                      requestId: rid,
                      payload: {
                        eventType: 'text_delta',
                        text: event.text,
                        stream: event.stream,
                        tag: event.tag,
                      },
                    })
                  );
                  break;
                case 'status':
                  client.send(
                    JSON.stringify({
                      type: 'event',
                      requestId: rid,
                      payload: {
                        eventType: 'status',
                        text: event.text,
                        tag: event.tag,
                        used: event.used,
                        size: event.size,
                      },
                    })
                  );
                  break;
                case 'tool_call':
                  client.send(
                    JSON.stringify({
                      type: 'event',
                      requestId: rid,
                      payload: {
                        eventType: 'tool_call',
                        text: event.text,
                        tag: event.tag,
                        toolCallId: event.toolCallId,
                        status: event.status,
                        title: event.title,
                      },
                    })
                  );
                  break;
                case 'error':
                  client.send(
                    JSON.stringify({
                      type: 'error',
                      requestId: rid,
                      payload: {
                        message: event.message,
                        code: event.code,
                        retryable: event.retryable,
                      },
                    })
                  );
                  return;
              }
            }

            client.send(
              JSON.stringify({
                type: 'done',
                requestId: rid,
                payload: { stopReason: 'success' },
              })
            );
          } catch (error) {
            await handleError(error, {
              module: 'acp:ws',
              action: 'runTurn',
              rethrow: false,
            });
            client.send(
              JSON.stringify({
                type: 'error',
                requestId: rid,
                payload: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              })
            );
          }
          return;
        }

        if (type === 'cancel') {
          if (currentHandle) {
            await runtime.cancel({
              handle: currentHandle,
              reason: payload?.reason as string | undefined,
            });
          }
          client.send(
            JSON.stringify({
              type: 'done',
              requestId: rid,
              payload: { stopReason: 'cancelled' },
            })
          );
          return;
        }

        if (type === 'close') {
          if (currentHandle) {
            await runtime.close({
              handle: currentHandle,
              reason: (payload?.reason as string) || 'Client closed',
            });
            currentHandle = null;
          }
          client.send(
            JSON.stringify({
              type: 'done',
              requestId: rid,
              payload: { stopReason: 'success' },
            })
          );
          client.close(1000, 'Session closed');
          return;
        }

        client.send(
          JSON.stringify({
            type: 'error',
            requestId: rid,
            payload: { message: `未知消息类型: ${type}` },
          })
        );
      });

      client.onClose(() => {
        if (currentHandle) {
          runtime
            .close({
              handle: currentHandle,
              reason: 'Client disconnected',
            })
            // @ignore-catch — 客户端断开时关闭代理session，fire-and-forget非关键
            .catch(() => {});
          currentHandle = null;
        }
        logger.info(
          `[ACP] 客户端已断开: ${client.id} (剩余 ${this.clients.size} 个)`
        );
      });

      otel.endSpan(span);
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'acp:ws',
        action: 'handleClientMessages',
        rethrow: false,
      });
    }
  }
}

/**
 * 创建 ACP WebSocket 远程桥接服务器
 */
export function createAcpWebSocketServer(
  runtime: AcpRuntime,
  config: AcpWebSocketServerConfig,
  sessionStore?: AcpSessionStore,
  options?: AcpServerOptions
): AcpWebSocketServer {
  return new AcpWebSocketServer(runtime, config, sessionStore, options);
}
