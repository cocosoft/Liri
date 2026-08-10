/**
 * SSH连接管理
 * 负责SSH远程连接的建立和管理
 */

import { spawn } from 'child_process';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('remote:SSHConnection');

/**
 * SSH连接配置
 */
export interface SSHConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  timeout?: number;
}

/**
 * SSH连接状态
 */
export enum SSHConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

/**
 * SSH连接类
 */
export class SSHConnection {
  private config: SSHConfig;
  private status: SSHConnectionStatus = SSHConnectionStatus.DISCONNECTED;
  private error: Error | null = null;

  constructor(config: SSHConfig) {
    this.config = {
      port: 22,
      timeout: 30000,
      ...config,
    };
  }

  /**
   * 连接到远程服务器
   */
  async connect(): Promise<boolean> {
    this.status = SSHConnectionStatus.CONNECTING;
    this.error = null;

    try {
      // 构建SSH命令
      const args = this.buildSSHArgs();

      // 执行SSH命令进行连接测试
      const result = await this.executeSSHCommand(args);

      if (result.success) {
        this.status = SSHConnectionStatus.CONNECTED;
        logger.info(`SSH connected to ${this.config.host}:${this.config.port}`);
        return true;
      } else {
        this.status = SSHConnectionStatus.ERROR;
        this.error = new Error(result.error || 'SSH connection failed');
        logger.error(`SSH connection failed: ${result.error}`);
        return false;
      }
    } catch (error) {
      this.status = SSHConnectionStatus.ERROR;
      this.error = error as Error;
      logger.error(
        'SSH connection error: ' +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.status = SSHConnectionStatus.DISCONNECTED;
    this.error = null;
    logger.info(
      `SSH disconnected from ${this.config.host}:${this.config.port}`
    );
  }

  /**
   * 执行远程命令
   */
  async executeCommand(
    command: string
  ): Promise<{ success: boolean; output: string; error: string }> {
    if (this.status !== SSHConnectionStatus.CONNECTED) {
      return { success: false, output: '', error: 'Not connected' };
    }

    try {
      const args = this.buildSSHArgs([command]);
      return await this.executeSSHCommand(args);
    } catch (error) {
      return { success: false, output: '', error: (error as Error).message };
    }
  }

  /**
   * 构建SSH命令参数
   */
  private buildSSHArgs(extraArgs: string[] = []): string[] {
    const args: string[] = [];

    if (this.config.port !== undefined) {
      args.push('-p', this.config.port.toString());
    }

    args.push(
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      `ConnectTimeout=${this.config.timeout ?? 30000}`
    );

    // 添加私钥
    if (this.config.privateKey) {
      args.push('-i', this.config.privateKey);
    }

    // 构建目标地址
    const target = `${this.config.username}@${this.config.host}`;

    return [...args, target, ...extraArgs];
  }

  /**
   * 执行SSH命令
   */
  private executeSSHCommand(
    args: string[]
  ): Promise<{ success: boolean; output: string; error: string }> {
    return new Promise((resolve) => {
      let output = '';
      let error = '';

      const sshProcess = spawn('ssh', args);

      sshProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      sshProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      sshProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output, error: '' });
        } else {
          resolve({ success: false, output, error });
        }
      });

      sshProcess.on('error', (err) => {
        resolve({ success: false, output: '', error: err.message });
      });

      // 超时处理
      setTimeout(() => {
        if (!sshProcess.killed) {
          sshProcess.kill();
          resolve({
            success: false,
            output: '',
            error: 'SSH connection timeout',
          });
        }
      }, this.config.timeout ?? 30000);
    });
  }

  /**
   * 获取连接状态
   */
  getStatus(): SSHConnectionStatus {
    return this.status;
  }

  /**
   * 获取错误信息
   */
  getError(): Error | null {
    return this.error;
  }

  /**
   * 获取连接配置
   */
  getConfig(): SSHConfig {
    return { ...this.config };
  }
}

/**
 * 创建SSH连接
 */
export function createSSHConnection(config: SSHConfig): SSHConnection {
  return new SSHConnection(config);
}
