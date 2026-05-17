/**
 * Docker 沙箱实现
 * 在 Docker 容器内隔离执行命令，实现 Sandbox 接口
 * 支持容器生命周期管理、资源限制、卷挂载
 */

import { execSync, exec } from 'node:child_process';
import { promisify } from 'util';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type {
  Sandbox,
  SandboxConfig,
  SandboxExecuteOptions,
  SandboxExecuteResult,
  SandboxPermission,
  SandboxPlatform,
} from '../types/SandboxTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { DockerImageManager } from './DockerImageManager';
import { validateDockerNetworkConfig } from './DockerNetworkPolicy';
import type { DockerNetworkMode } from './DockerNetworkPolicy';

const execAsync = promisify(exec);
const logger = new Logger({ level: LogLevel.INFO });

/**
 * Docker 沙箱专有配置键名（存放在 SandboxConfig.customConfig 中）
 */
export const DOCKER_CONFIG_KEYS = {
  IMAGE: 'dockerImage',
  NETWORK_MODE: 'dockerNetworkMode',
  CPU_LIMIT: 'dockerCpuLimit',
  MEMORY_LIMIT: 'dockerMemoryLimit',
  VOLUMES: 'dockerVolumes',
  CONTAINER_NAME: 'dockerContainerName',
  READ_ONLY: 'dockerReadOnly',
} as const;

/**
 * Docker 卷挂载配置
 */
export interface DockerVolumeMount {
  hostPath: string;
  containerPath: string;
  mode: 'ro' | 'rw';
}

/**
 * Docker 沙箱默认配置
 */
const DEFAULT_DOCKER_SETTINGS = {
  image: 'node:24-alpine',
  networkMode: 'none' as const,
  readOnly: true,
  memoryLimit: '512m',
  cpuLimit: '0.5',
  volumes: [] as DockerVolumeMount[],
};

export class DockerSandbox implements Sandbox {
  private config: SandboxConfig;
  private isInitializedFlag: boolean = false;
  private containerId: string | null = null;
  private containerName: string;
  private imageManager: DockerImageManager;

  constructor() {
    this.config = null as unknown as SandboxConfig;
    this.containerName = '';
    this.imageManager = new DockerImageManager();
  }

  async initialize(config: SandboxConfig): Promise<boolean> {
    this.config = config;
    const custom = config.customConfig || {};

    this.containerName =
      (custom[DOCKER_CONFIG_KEYS.CONTAINER_NAME] as string) ||
      `pyapp-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      this.checkDockerAvailable();

      const image =
        (custom[DOCKER_CONFIG_KEYS.IMAGE] as string) ||
        DEFAULT_DOCKER_SETTINGS.image;

      const imageExists = await this.imageManager.imageExists(image);
      if (!imageExists) {
        logger.info(`拉取 Docker 镜像: ${image}`);
        await this.imageManager.pullImage(image);
      }

      const networkMode =
        (custom[DOCKER_CONFIG_KEYS.NETWORK_MODE] as string) ||
        DEFAULT_DOCKER_SETTINGS.networkMode;

      const networkValid = validateDockerNetworkConfig({
        mode: networkMode as DockerNetworkMode,
      });
      if (!networkValid.valid) {
        throw new AppError(
          `无效的网络模式: ${networkMode} — ${networkValid.reason}`,
          ErrorCategory.CONFIGURATION,
          ErrorSeverity.HIGH,
          'INVALID_NETWORK_MODE'
        );
      }

      const args: string[] = ['docker', 'create'];

      if (networkMode !== 'bridge') {
        args.push('--network', networkMode);
      }

      const readOnly =
        (custom[DOCKER_CONFIG_KEYS.READ_ONLY] as boolean) ??
        DEFAULT_DOCKER_SETTINGS.readOnly;
      if (readOnly) {
        args.push('--read-only');
        args.push('--tmpfs', '/tmp:rw,noexec,nosuid');
      }

      const memoryLimit =
        (custom[DOCKER_CONFIG_KEYS.MEMORY_LIMIT] as string) ||
        DEFAULT_DOCKER_SETTINGS.memoryLimit;
      const cpuLimit =
        (custom[DOCKER_CONFIG_KEYS.CPU_LIMIT] as string) ||
        DEFAULT_DOCKER_SETTINGS.cpuLimit;
      args.push('--memory', memoryLimit, '--cpus', cpuLimit);
      args.push('--name', this.containerName);

      const containerVolumes =
        (custom[DOCKER_CONFIG_KEYS.VOLUMES] as DockerVolumeMount[]) ||
        DEFAULT_DOCKER_SETTINGS.volumes;
      for (const vol of containerVolumes) {
        args.push('-v', `${vol.hostPath}:${vol.containerPath}:${vol.mode}`);
      }

      for (const envKey of config.environmentWhitelist) {
        const envValue = process.env[envKey];
        if (envValue !== undefined) {
          args.push('-e', `${envKey}=${envValue}`);
        }
      }

      args.push(image, 'tail', '-f', '/dev/null');

      const output = execSync(args.join(' '), { encoding: 'utf-8' }).trim();
      this.containerId = output;
      logger.info(
        `Docker 容器已创建: ${this.containerId} (${this.containerName})`
      );

      execSync(`docker start ${this.containerName}`, { stdio: 'pipe' });
      this.isInitializedFlag = true;
      return true;
    } catch (error) {
      logger.error('Docker 沙箱初始化失败', error as Error);
      this.isInitializedFlag = false;
      return false;
    }
  }

  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();
    const command = options.args.join(' ');

    try {
      if (!this.containerId) {
        const ok = await this.initialize(this.config);
        if (!ok) {
          return {
            success: false,
            exitCode: -1,
            stdout: '',
            stderr: 'Docker 沙箱初始化失败',
            executionTime: Date.now() - startTime,
            durationMs: Date.now() - startTime,
            timedOut: false,
          };
        }
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

      execArgs.push(this.containerName, 'sh', '-c', safeCommand);

      const execStr = execArgs.join(' ');
      logger.debug(`Docker 执行: ${execStr}`);

      const timeout = options.timeout || this.config.maxExecutionTime;
      const { stdout, stderr } = await execAsync(execStr, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        executionTime: Date.now() - startTime,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    } catch (error: any) {
      const isTimeout = error.killed || error.message?.includes('timeout');
      return {
        success: false,
        exitCode: error.code || error.status || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || String(error),
        executionTime: Date.now() - startTime,
        durationMs: Date.now() - startTime,
        timedOut: !!isTimeout,
        error: error.stderr || error.message || String(error),
      };
    }
  }

  async close(): Promise<boolean> {
    try {
      if (this.containerId) {
        execSync(`docker rm -f ${this.containerName}`, { stdio: 'pipe' });
        logger.info(`Docker 容器已销毁: ${this.containerName}`);
        this.containerId = null;
      }
      this.isInitializedFlag = false;
      return true;
    } catch (error) {
      logger.error('Docker 容器销毁失败', error as Error);
      this.isInitializedFlag = false;
      return false;
    }
  }

  getStatus(): {
    isInitialized: boolean;
    platform: SandboxPlatform;
    config: SandboxConfig;
  } {
    return {
      isInitialized: this.isInitializedFlag,
      platform: this.config?.platform,
      config: this.config,
    };
  }

  hasPermission(permission: SandboxPermission): boolean {
    return this.config?.allowedPermissions?.includes(permission) ?? false;
  }

  addFilesystemWhitelist(path: string): boolean {
    if (!this.config.filesystemWhitelist.includes(path)) {
      this.config.filesystemWhitelist.push(path);
      return true;
    }
    return false;
  }

  addNetworkWhitelist(host: string): boolean {
    if (!this.config.networkWhitelist.includes(host)) {
      this.config.networkWhitelist.push(host);
      return true;
    }
    return false;
  }

  addEnvironmentWhitelist(envVar: string): boolean {
    if (!this.config.environmentWhitelist.includes(envVar)) {
      this.config.environmentWhitelist.push(envVar);
      return true;
    }
    return false;
  }

  getContainerId(): string | null {
    return this.containerId;
  }

  getContainerName(): string {
    return this.containerName;
  }

  private checkDockerAvailable(): void {
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    } catch {
      throw new AppError(
        'Docker 不可用，无法使用 Docker 沙箱',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'DEPENDENCY_UNAVAILABLE'
      );
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
