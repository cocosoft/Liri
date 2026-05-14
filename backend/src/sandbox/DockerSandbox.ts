/**
 * Docker 沙箱后端
 * 在 Docker 容器内隔离执行命令，支持镜像管理和卷挂载
 * 对齐 OpenClaw agents/sandbox/docker.ts
 */

import type {
  SandboxExecuteOptions,
  SandboxExecuteResult,
} from './types/SandboxTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

export interface DockerSandboxConfig {
  image: string;
  containerName?: string;
  networkMode: 'none' | 'bridge' | 'host';
  readOnly: boolean;
  memoryLimit: string;
  cpuLimit: string;
  timeoutMs: number;
  volumes: Array<{
    hostPath: string;
    containerPath: string;
    mode: 'ro' | 'rw';
  }>;
  envVars: Record<string, string>;
}

export interface DockerSandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

const DEFAULT_CONFIG: DockerSandboxConfig = {
  image: 'node:24-alpine',
  networkMode: 'none',
  readOnly: true,
  memoryLimit: '512m',
  cpuLimit: '0.5',
  timeoutMs: 300000,
  volumes: [],
  envVars: {},
};

export class DockerSandbox {
  private config: DockerSandboxConfig;
  private containerId: string | null = null;

  constructor(config: Partial<DockerSandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!this.config.containerName) {
      this.config.containerName = `pyapp-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  getContainerId(): string | null {
    return this.containerId;
  }

  getContainerName(): string {
    return this.config.containerName!;
  }

  async create(): Promise<boolean> {
    try {
      this.checkDockerAvailable();

      // 拉取镜像
      logger.info(`拉取 Docker 镜像: ${this.config.image}`);
      execSync(`docker pull ${this.config.image}`, {
        stdio: 'pipe',
        timeout: 60000,
      });

      // 创建容器
      const args: string[] = ['docker', 'create'];

      if (this.config.networkMode !== 'bridge') {
        args.push('--network', this.config.networkMode);
      }
      if (this.config.readOnly) {
        args.push('--read-only');
        args.push('--tmpfs', '/tmp:rw,noexec,nosuid');
      }
      args.push(
        '--memory',
        this.config.memoryLimit,
        '--cpus',
        this.config.cpuLimit
      );
      args.push('--name', this.config.containerName!);

      for (const vol of this.config.volumes) {
        args.push('-v', `${vol.hostPath}:${vol.containerPath}:${vol.mode}`);
      }
      for (const [key, value] of Object.entries(this.config.envVars)) {
        args.push('-e', `${key}=${value}`);
      }

      args.push(this.config.image, 'tail', '-f', '/dev/null');

      const output = execSync(args.join(' '), { encoding: 'utf-8' }).trim();
      this.containerId = output;
      logger.info(
        `Docker 容器已创建: ${this.containerId} (${this.config.containerName})`
      );

      // 启动容器
      execSync(`docker start ${this.config.containerName}`, { stdio: 'pipe' });
      return true;
    } catch (error) {
      logger.error('Docker 容器创建失败', error as Error);
      return false;
    }
  }

  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();
    const command = options.args.join(' ');

    try {
      if (!this.containerId) {
        await this.create();
      }

      const safeCommand = this.sanitizeCommand(command);
      const execArgs: string[] = [
        'docker',
        'exec',
        ...(options.cwd ? ['-w', options.cwd] : []),
      ];

      if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
          execArgs.push('-e', `${key}=${value}`);
        }
      }

      execArgs.push(this.config.containerName!, 'sh', '-c', safeCommand);

      const execStr = execArgs.join(' ');
      logger.debug(`Docker 执行: ${execStr}`);

      const timeout = options.timeout || this.config.timeoutMs;
      const output = execSync(execStr, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        stdio: 'pipe',
      });

      return {
        exitCode: 0,
        stdout: output,
        stderr: '',
        executionTime: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        status?: number;
        killed?: boolean;
      };
      return {
        exitCode: err.status || 1,
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        executionTime: Date.now() - startTime,
        success: false,
        error: err.stderr || String(error),
      };
    }
  }

  async destroy(): Promise<void> {
    try {
      if (this.containerId) {
        execSync(`docker rm -f ${this.config.containerName}`, {
          stdio: 'pipe',
        });
        logger.info(`Docker 容器已销毁: ${this.config.containerName}`);
        this.containerId = null;
      }
    } catch (error) {
      logger.error('Docker 容器销毁失败', error as Error);
    }
  }

  private checkDockerAvailable(): void {
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    } catch {
      throw new Error('Docker 不可用，无法使用 Docker 沙箱');
    }
  }

  private sanitizeCommand(command: string): string {
    return command
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
  }
}
