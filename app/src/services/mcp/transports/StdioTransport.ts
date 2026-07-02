/**
 * Stdio传输层
 * 基于标准输入输出与子进程通信
 */

import { spawn, type ChildProcess } from 'child_process';
import type { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({
  module: 'services:mcp:stdio',
  level: LogLevel.INFO,
});

/**
 * Stdio传输层选项
 */
interface StdioTransportOptions {
  /** 命令 */
  command: string;
  /** 参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
}

/**
 * Stdio传输层
 */
export class StdioTransport extends MCPTransport {
  private readonly command: string;
  private readonly args: string[];
  private readonly env: Record<string, string>;
  private process: ChildProcess | null = null;
  private stdoutBuffer: string = '';
  private pendingRequests: Map<
    string,
    { resolve: (response: MCPResponse) => void; reject: (error: Error) => void }
  > = new Map();

  constructor(options: StdioTransportOptions) {
    super();
    this.command = options.command;
    this.args = options.args || [];
    this.env = {
      ...this.filterUndefined(process.env),
      ...options.env,
    };
  }

  /**
   * 过滤undefined值
   */
  private filterUndefined(obj: NodeJS.ProcessEnv): Record<string, string> {
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  /**
   * 连接
   */
  override async connect(): Promise<void> {
    if (this.process) {
      return;
    }

    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env,
    });

    // 处理标准输出
    this.process.stdout?.on('data', (data) => {
      this.stdoutBuffer += data.toString();
      this.processOutput();
    });

    // 处理标准错误
    this.process.stderr?.on('data', (data) => {
      logger.error(`MCP stderr: ${data.toString()}`);
    });

    // 处理进程退出
    this.process.on('exit', (code) => {
      logger.info(`MCP process exited with code ${code}`);
      this.connected = false;
      this.process = null;

      // 拒绝所有未完成的请求
      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`MCP process exited`));
      }
      this.pendingRequests.clear();
    });

    await super.connect();
  }

  /**
   * 断开连接
   */
  override disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    super.disconnect();
  }

  /**
   * 发送请求
   */
  async send(request: MCPRequest): Promise<MCPResponse> {
    if (!this.process || !this.connected) {
      throw new AppError(
        'Not connected to MCP server',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });

      // 发送请求
      const requestString = JSON.stringify(request) + '\n';
      this.process?.stdin?.write(requestString);
    });
  }

  /**
   * 处理输出
   */
  private processOutput(): void {
    const lines = this.stdoutBuffer.split('\n');

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const response: MCPResponse = JSON.parse(line);
        const requestId = response.id;
        const pendingRequest = this.pendingRequests.get(requestId);

        if (pendingRequest) {
          pendingRequest.resolve(response);
          this.pendingRequests.delete(requestId);
        }
      } catch (error) {
        logger.error(`Failed to parse MCP response: ${line}`);
      }
    }

    // 保留最后一行（可能不完整）
    this.stdoutBuffer = lines[lines.length - 1];
  }
}
