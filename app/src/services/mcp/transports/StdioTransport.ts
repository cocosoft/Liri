/**
 * Stdio传输层
 * 基于标准输入输出与子进程通信
 *
 * 对标 hermes _kill_orphaned_mcp_children:
 *   - connect() 前清理旧进程（避免重连孤儿泄漏）
 *   - disconnect() 两阶段终止（SIGTERM → 2s 等待 → SIGKILL）
 *   - 通过 ChildProcessTracker 全局追踪活跃/孤儿进程
 */
import { spawn, type ChildProcess } from 'child_process';
import type { MCPRequest, MCPResponse } from '../types';
import { MCPTransport } from './MCPTransport';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { trackProcess, untrackProcess } from './ChildProcessTracker';
import { buildSafeEnv, stripCredentials } from '../MCPSecurityFilter';

const logger = new Logger({
  module: 'services:mcp:stdio',
  level: LogLevel.INFO,
});

/** 两阶段清理的优雅等待时间（毫秒） */
const GRACE_PERIOD_MS = 2000;

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
    // P2-4: 使用 buildSafeEnv() 仅传递安全基线环境变量，而非全部 process.env
    const extraKeys = options.env ? Object.keys(options.env) : [];
    this.env = {
      ...buildSafeEnv(extraKeys),
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
   * 先终止旧进程（防止重连孤儿泄漏），再创建新进程
   */
  override async connect(): Promise<void> {
    // 清理旧进程（对标 hermes：重连前 teardown 旧连接）
    if (this.process) {
      await this.killProcess();
    }

    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env,
    });

    // 注册到全局进程追踪器
    const serverName = this.command + ' ' + (this.args || []).join(' ');
    trackProcess(this.process, serverName);

    // 处理标准输出
    this.process.stdout?.on('data', (data) => {
      this.stdoutBuffer += data.toString();
      this.processOutput();
    });

    // 处理标准错误
    // P2-4: stderr 输出需脱敏，防止凭据泄露到日志
    this.process.stderr?.on('data', (data) => {
      const raw = data.toString();
      const { cleaned } = stripCredentials(raw);
      handleError(new Error(`MCP stderr: ${cleaned}`), {
        module: 'services:mcp:stdio',
        action: 'MCP标准错误输出',
      });
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
   * 断开连接（两阶段终止）
   * Phase 1: SIGTERM（优雅退出）
   * Phase 2: 等待 2s
   * Phase 3: SIGKILL 兜底
   */
  override disconnect(): void {
    if (this.process) {
      this.killProcess();
    }
    super.disconnect();
  }

  /**
   * 两阶段终止子进程
   * 对标 hermes: _kill_orphaned_mcp_children 的 kill 逻辑
   */
  private killProcess(): void {
    const proc = this.process;
    if (!proc) return;

    this.process = null;

    // 先尝试 SIGTERM
    try {
      proc.kill('SIGTERM');
    } catch (err) {
      // SIGTERM 不可用（Windows），直接强制终止
      try {
        proc.kill();
      } catch (err) {
        // 已退出
      }
      untrackProcess(proc);
      return;
    }

    // 等待后 SIGKILL 兜底
    const sigkillTimer = setTimeout(() => {
      try {
        proc.kill(0); // 探测存活
        // 仍存活 → 强制终止
        try {
          proc.kill('SIGKILL');
        } catch (err) {
          proc.kill();
        }
      } catch (err) {
        // 已退出
      }
      untrackProcess(proc);
    }, GRACE_PERIOD_MS);

    // 进程在等待期内自行退出
    proc.once('exit', () => {
      clearTimeout(sigkillTimer);
      untrackProcess(proc);
    });
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
        handleError(error, {
          module: 'services:mcp:stdio',
          action: '解析MCP响应失败',
        });
      }
    }

    // 保留最后一行（可能不完整）
    this.stdoutBuffer = lines[lines.length - 1];
  }
}
