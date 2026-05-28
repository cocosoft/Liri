import http from 'http';
import fs from 'fs';
import path from 'path';
import { Logger } from '../monitoring/logs/Logger';
import { getMonitoringService } from '../monitoring/MonitoringService';
import { resolveDataDir } from '../config/paths';

const logger = new Logger({ level: 'info' as any });

export interface IPCMessage {
  type: string;
  payload: unknown;
  id?: string;
}

export interface IPCHandler {
  (message: IPCMessage): Promise<unknown>;
}

export type IPCTransport = 'http' | 'unix';

export interface IPCServiceConfig {
  host?: string;
  port?: number;
  transport?: IPCTransport;
  socketPath?: string;
}

export class IPCService {
  private server: http.Server | null;
  private handlers: Map<string, IPCHandler>;
  private config: Required<IPCServiceConfig>;

  constructor(config: IPCServiceConfig = {}) {
    this.server = null;
    this.handlers = new Map();
    this.config = {
      host: config.host ?? '127.0.0.1',
      port: config.port ?? 0,
      transport: config.transport ?? 'http',
      socketPath: config.socketPath ?? path.join(resolveDataDir(), 'ipc.sock'),
    };
  }

  on(type: string, handler: IPCHandler): void {
    this.handlers.set(type, handler);
  }

  off(type: string): void {
    this.handlers.delete(type);
  }

  async start(): Promise<void> {
    if (this.server) {
      logger.warning('IPC 服务已在运行');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method Not Allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const message: IPCMessage = JSON.parse(body);
            const handler = this.handlers.get(message.type);
            if (handler) {
              const result = await handler(message);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, data: result }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  success: false,
                  error: `未知消息类型: ${message.type}`,
                })
              );
            }
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '解析失败',
              })
            );
          }
        });
      });

      if (this.config.transport === 'unix') {
        const socketDir = path.dirname(this.config.socketPath);
        if (!fs.existsSync(socketDir)) {
          fs.mkdirSync(socketDir, { recursive: true });
        }
        if (fs.existsSync(this.config.socketPath)) {
          fs.unlinkSync(this.config.socketPath);
        }
        this.server.listen(this.config.socketPath, () => {
          logger.info(
            `IPC 服务已启动 (Unix Socket): ${this.config.socketPath}`
          );
          this.reportRunning(true);
          resolve();
        });
      } else {
        this.server.listen(this.config.port, this.config.host, () => {
          logger.info(
            `IPC 服务已启动 (HTTP): ${this.config.host}:${this.config.port}`
          );
          this.reportRunning(true);
          resolve();
        });
      }

      this.server.on('error', (error) => {
        logger.error('IPC 服务启动失败', error);
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      const socketPath = this.config.socketPath;
      this.server!.close((err) => {
        if (err) {
          logger.error('IPC 服务关闭失败', err);
          reject(err);
        } else {
          logger.info('IPC 服务已关闭');
          this.server = null;
          if (this.config.transport === 'unix' && fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
          }
          this.reportRunning(false);
          resolve();
        }
      });
    });
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  getAddress(): string {
    if (this.config.transport === 'unix') {
      return `unix:${this.config.socketPath}`;
    }
    return `${this.config.host}:${this.config.port}`;
  }

  getTransport(): IPCTransport {
    return this.config.transport;
  }

  private reportRunning(running: boolean): void {
    try {
      getMonitoringService().addMetric('daemon.ipc.running', running ? 1 : 0);
    } catch {
      // MonitoringService not available, skip metric reporting
    }
  }
}
