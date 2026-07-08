/**
 * SSHSandbox SSH 远程沙箱
 * 在远程 SSH 服务器上隔离执行命令
 * 对标 OpenClaw agents/sandbox/ssh.ts
 */

import type {
  SandboxExecuteOptions,
  SandboxExecuteResult,
} from './SandboxTypes';
import { Logger, LogLevel } from '@modules/monitoring';
import { spawn, type ChildProcess } from 'child_process';

const logger = new Logger({ module: 'sandbox:ssh', level: LogLevel.INFO });

/**
 * SSH 沙箱配置
 */
export interface SSHSandboxConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  jumpHost?: string;
  jumpPort?: number;
  jumpUsername?: string;
  jumpPrivateKeyPath?: string;
}

const DEFAULT_CONFIG: SSHSandboxConfig = {
  host: '',
  port: 22,
  username: 'root',
  timeoutMs: 300000,
  maxOutputBytes: 1024 * 1024,
};

/**
 * SSH 连接状态
 */
export interface SSHConnectionStatus {
  connected: boolean;
  host: string;
  port: number;
  username: string;
  latencyMs: number;
  lastActiveAt: number | null;
  error?: string;
}

/**
 * SSH 远程沙箱
 */
export class SSHSandbox {
  private config: SSHSandboxConfig;
  private connected: boolean = false;
  private lastActiveAt: number | null = null;
  private fallbackHost: string | null = null;

  constructor(config: Partial<SSHSandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 构建 SSH 连接参数数组
   */
  private buildSshArgs(remoteCmd: string): string[] {
    const args: string[] = [
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'BatchMode=yes',
      '-p',
      String(this.config.port),
    ];

    if (this.config.privateKeyPath) {
      args.push('-i', this.config.privateKeyPath);
    }

    if (this.config.jumpHost) {
      const jumpUser = this.config.jumpUsername || this.config.username;
      const jumpPort = this.config.jumpPort || 22;
      const jumpKey =
        this.config.jumpPrivateKeyPath || this.config.privateKeyPath;

      let jumpTarget = `${jumpUser}@${this.config.jumpHost}`;
      if (jumpKey) {
        args.push('-J', `${jumpTarget}:${jumpPort}`);
      } else {
        args.push('-J', `${jumpTarget}:${jumpPort}`);
      }
    }

    args.push(`${this.config.username}@${this.config.host}`);
    args.push(remoteCmd);

    return args;
  }

  /**
   * 连接 SSH 服务器
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;

    if (!this.config.host) {
      logger.error('SSH 主机地址未配置');
      return false;
    }

    if (!this.config.privateKeyPath && !this.config.password) {
      logger.warning('SSH 认证方式未配置，尝试使用默认密钥');
    }

    try {
      const result = await this.executeCommand('echo "SSH_CONNECTED"');
      this.connected = result.exitCode === 0;
      if (this.connected) {
        this.lastActiveAt = Date.now();
        logger.info(
          `SSH 连接成功: ${this.config.username}@${this.config.host}`
        );
      }
      return this.connected;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`SSH 连接失败: ${errMsg}`);

      if (this.fallbackHost) {
        logger.info(`尝试备用主机: ${this.fallbackHost}`);
        this.config.host = this.fallbackHost;
        this.fallbackHost = null;
        return this.connect();
      }

      return false;
    }
  }

  /**
   * 断开 SSH 连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.lastActiveAt = null;
    logger.info(`SSH 已断开: ${this.config.username}@${this.config.host}`);
  }

  /**
   * 执行命令返回结果
   */
  private executeCommand(
    cmd: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const args = this.buildSshArgs(cmd);
      const proc = spawn('ssh', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.config.timeoutMs,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, this.config.timeoutMs);

      proc.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < this.config.maxOutputBytes) {
          stdout += data.toString('utf-8').trimEnd();
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < this.config.maxOutputBytes) {
          stderr += data.toString('utf-8').trimEnd();
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error('SSH 命令执行超时'));
        } else {
          resolve({ exitCode: code ?? -1, stdout, stderr });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * 执行沙箱命令
   */
  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();
    const command = options.args.join(' ');

    if (!this.connected) {
      const ok = await this.connect();
      if (!ok) {
        return {
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: 'SSH 连接失败',
          executionTime: Date.now() - startTime,
          durationMs: Date.now() - startTime,
          timedOut: false,
        };
      }
    }

    try {
      const result = await this.executeCommand(command);
      this.lastActiveAt = Date.now();

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        executionTime: Date.now() - startTime,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: errMsg,
        executionTime: Date.now() - startTime,
        durationMs: Date.now() - startTime,
        timedOut: errMsg.includes('超时'),
      };
    }
  }

  /**
   * 获取连接状态
   */
  getStatus(): SSHConnectionStatus {
    return {
      connected: this.connected,
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      latencyMs: -1,
      lastActiveAt: this.lastActiveAt,
    };
  }

  /**
   * 配置备用主机（自动故障转移）
   */
  setFallback(host: string): void {
    this.fallbackHost = host;
  }
}
