/**
 * Docker 沙箱实现
 * 在 Docker 容器内隔离执行命令，实现 Sandbox 接口
 * 支持容器生命周期管理、资源限制、卷挂载
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error/handleError';
import type {
  Sandbox,
  SandboxConfig,
  SandboxExecuteOptions,
  SandboxExecuteResult,
  SandboxPermission,
  SandboxPlatform,
} from '../SandboxTypes';
import { getLogger } from '@modules/monitoring';
import { DockerImageManager } from './DockerImageManager';
import { validateDockerNetworkConfig } from './DockerNetworkPolicy';
import type {
  DockerNetworkMode,
  DockerNetworkConfig,
} from './DockerNetworkPolicy';
import { compileNetworkPolicy } from './NetworkPolicyEngine';
import { defaultDockerCliRunner, type DockerCliRunner } from './dockerCli';

const logger = getLogger('sandbox:docker:dockerSandbox');

/**
 * Docker 沙箱专有配置键名（存放在 SandboxConfig.customConfig 中）
 */
export const DOCKER_CONFIG_KEYS = {
  IMAGE: 'dockerImage',
  NETWORK_MODE: 'dockerNetworkMode',
  /**
   * B 组遗留修复（2026-09-26）：`dockerNetworkMode: 'custom'` 时**必须**给网络名。
   *
   * 此前缺此键 ⇒ `DockerSandbox` 从不填 `customNetworkName`，而
   * `validateDockerNetworkConfig` 对 custom **强制要求**名字 ⇒ **custom 模式恒在
   * `INVALID_NETWORK_MODE` 处失败**（无论用户怎么配）。声明层
   * （`compileNetworkPolicy`）本就支持 custom，只是名字从未被传进去。
   */
  CUSTOM_NETWORK_NAME: 'dockerCustomNetworkName',
  CPU_LIMIT: 'dockerCpuLimit',
  MEMORY_LIMIT: 'dockerMemoryLimit',
  VOLUMES: 'dockerVolumes',
  CONTAINER_NAME: 'dockerContainerName',
  READ_ONLY: 'dockerReadOnly',
  ALLOWED_DOMAINS: 'allowedDomains',
  BLOCKED_DOMAINS: 'blockedDomains',
  ALLOWED_PORTS: 'allowedPorts',
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

  /**
   * B4（2026-09-26）：`run` **可注入** —— ① 消除本文件原先的 `execSync`（initialize / close /
   * 可用性探测都曾是同步阻塞）；② 使"**真实退出码**"可在无 Docker 环境下离线断言。
   * `imageManager` 共用同一执行器。
   */
  constructor(
    private readonly run: DockerCliRunner = defaultDockerCliRunner,
    private readonly imageManager: DockerImageManager = new DockerImageManager(
      run
    )
  ) {
    this.config = null as unknown as SandboxConfig;
    this.containerName = '';
  }

  async initialize(config: SandboxConfig): Promise<boolean> {
    this.config = config;
    const custom = config.customConfig || {};

    this.containerName =
      (custom[DOCKER_CONFIG_KEYS.CONTAINER_NAME] as string) ||
      `pyapp-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      await this.checkDockerAvailable();

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

      const networkConfig: DockerNetworkConfig = {
        mode: networkMode as DockerNetworkMode,
        // B 组遗留修复（2026-09-26）：custom 模式必须带上网络名，否则校验必失败（见 DOCKER_CONFIG_KEYS 注释）
        customNetworkName: custom[DOCKER_CONFIG_KEYS.CUSTOM_NETWORK_NAME] as
          | string
          | undefined,
        allowedDomains: custom[DOCKER_CONFIG_KEYS.ALLOWED_DOMAINS] as
          | string[]
          | undefined,
        blockedDomains: custom[DOCKER_CONFIG_KEYS.BLOCKED_DOMAINS] as
          | string[]
          | undefined,
        allowedPorts: custom[DOCKER_CONFIG_KEYS.ALLOWED_PORTS] as
          | number[]
          | undefined,
      };

      const networkValid = validateDockerNetworkConfig(networkConfig);
      if (!networkValid.valid) {
        throw new AppError(
          `无效的网络模式: ${networkMode} — ${networkValid.reason}`,
          ErrorCategory.CONFIGURATION,
          ErrorSeverity.HIGH,
          'INVALID_NETWORK_MODE'
        );
      }

      // B4：参数数组**不含** `docker` 本身（执行器负责调用 docker 二进制，且不经宿主 shell）
      const args: string[] = ['create'];

      // B2（2026-09-26）：网络策略改为**声明层** —— 本仓只下达宿主侧参数
      // （`--network` / `--add-host`），**不再** `--cap-add=NET_ADMIN`、**不再** `docker exec` 进容器下发。
      const networkPlan = compileNetworkPolicy(networkConfig);
      if (networkPlan.narrowedByFailClosed) {
        logger.warn(
          '网络模式已按 fail-closed 收窄为 none：配置了端口白名单但宿主侧无执行器（B2）',
          {
            requested: networkPlan.sourceMode,
            allowedPorts: networkPlan.allowedPorts,
          }
        );
      }
      if (networkPlan.unenforcedInThisRepo.length > 0) {
        logger.warn('以下网络限制**本仓不执行**（需宿主侧落地，B2）', {
          items: networkPlan.unenforcedInThisRepo,
        });
      }
      args.push(...networkPlan.dockerArgs);

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

      // B4（2026-09-26）：改**异步执行器** + **参数数组**（原先 `execSync(args.join(' '))` 既阻塞
      // 事件循环、又经宿主 shell 二次解释参数），并**按退出码判定成败**而非"没抛异常即成功"。
      const createRes = await this.run(args, { timeoutMs: 120_000 });
      if (!createRes.ok || !createRes.stdout.trim()) {
        throw new AppError(
          `docker create 失败（退出码 ${String(createRes.code)}）：${createRes.stderr.trim() || '无输出'}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'DOCKER_CREATE_FAILED'
        );
      }
      this.containerId = createRes.stdout.trim();
      logger.info(
        `Docker 容器已创建: ${this.containerId} (${this.containerName})`
      );

      const startRes = await this.run(['start', this.containerName], {
        timeoutMs: 60_000,
      });
      if (!startRes.ok) {
        throw new AppError(
          `docker start 失败（退出码 ${String(startRes.code)}）：${startRes.stderr.trim() || '无输出'}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'DOCKER_START_FAILED'
        );
      }

      // B2：**不再**在容器内下发策略 —— 原 `NetworkPolicyEngine.applyPolicy()`
      // （`docker exec … iptables …` / `echo >> /etc/hosts`）已整体移除；本仓已下达的**宿主侧**
      // 参数见上方 `networkPlan.dockerArgs`，其余限制需宿主侧执行层（见 B2 spec）。

      this.isInitializedFlag = true;
      return true;
    } catch (error) {
      void handleError(error, {
        module: 'sandbox:docker',
        action: 'initialize',
      });
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

      // B4（2026-09-26）：**去掉 `sanitizeCommand`** —— 参数改为**数组直传**（不经宿主 shell），
      // 原先那套转义是给"拼字符串交给 shell"用的；保留会把反斜杠/引号**双重转义**进容器。
      const execArgs: string[] = [
        'exec',
        ...(options.cwd ? ['-w', options.cwd] : []),
      ];

      if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
          execArgs.push('-e', `${key}=${value}`);
        }
      }

      execArgs.push(this.containerName, 'sh', '-c', command);

      logger.debug(`Docker 执行: docker ${execArgs.join(' ')}`);

      const timeoutMs = options.timeout || this.config.maxExecutionTime;
      const res = await this.run(execArgs, {
        timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (res.code === null) {
        // 未取到退出码（spawn 失败 / 被杀）⇒ 保持"执行异常"语义
        void handleError(res.error ?? new Error('docker exec 未返回退出码'), {
          module: 'sandbox:docker',
          action: 'execute',
        });
        return {
          success: false,
          exitCode: -1,
          stdout: res.stdout,
          stderr: res.stderr,
          executionTime: Date.now() - startTime,
          durationMs: Date.now() - startTime,
          timedOut: res.timedOut,
          error: res.stderr || 'docker exec 未返回退出码',
        };
      }

      // B4（2026-09-26）：**用真实退出码**判定成败 —— 此前 try 分支写死 `success: true, exitCode: 0`
      return {
        success: res.code === 0,
        exitCode: res.code,
        stdout: res.stdout,
        stderr: res.stderr,
        executionTime: Date.now() - startTime,
        durationMs: Date.now() - startTime,
        timedOut: res.timedOut,
        ...(res.code === 0
          ? {}
          : { error: res.stderr.trim() || `docker exec 退出码 ${res.code}` }),
      };
    } catch (error) {
      void handleError(error, { module: 'sandbox:docker', action: 'execute' });
      const execErr = error as {
        code?: number;
        status?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
        killed?: boolean;
      };
      const isTimeout = execErr.killed || execErr.message?.includes('timeout');
      return {
        success: false,
        exitCode: execErr.code || execErr.status || 1,
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || execErr.message || String(error),
        executionTime: Date.now() - startTime,
        durationMs: Date.now() - startTime,
        timedOut: !!isTimeout,
        error: execErr.stderr || execErr.message || String(error),
      };
    }
  }

  async close(): Promise<boolean> {
    try {
      if (this.containerId) {
        // B4：改异步执行器（原先 `execSync` 会在关闭路径上阻塞事件循环），并按退出码判定
        const res = await this.run(['rm', '-f', this.containerName], {
          timeoutMs: 30_000,
        });
        if (!res.ok) {
          throw new Error(
            `docker rm -f 失败（退出码 ${String(res.code)}）：${res.stderr.trim() || '无输出'}`
          );
        }
        logger.info(`Docker 容器已销毁: ${this.containerName}`);
        this.containerId = null;
      }
      this.isInitializedFlag = false;
      return true;
    } catch (error) {
      void handleError(error, { module: 'sandbox:docker', action: 'close' });
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

  private async checkDockerAvailable(): Promise<void> {
    const res = await this.run(['info'], { timeoutMs: 5000 });
    if (!res.ok) {
      throw new AppError(
        'Docker 不可用，无法使用 Docker 沙箱',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'DEPENDENCY_UNAVAILABLE'
      );
    }
  }
}
