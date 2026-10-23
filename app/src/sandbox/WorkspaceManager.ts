/**
 * 工作空间管理器
 * 统一管理各种 Workspace 实例的创建和生命周期
 * 对标 AgentScope WorkspaceManager
 */

import { WorkspaceBase } from './WorkspaceBase';
import { LocalWorkspace } from './adapters/LocalWorkspace';
import { DockerWorkspace } from './adapters/DockerWorkspace';
import { SSHWorkspace } from './adapters/SSHWorkspace';
import {
  SandboxConfig,
  SandboxPlatform,
  SandboxPermission,
} from './SandboxTypes';
import type { SSHSandboxConfig } from './SSHSandbox';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

// PR-3a（2026-10-23）：权限位解析与默认值收敛到 `./permissionLevel`（单一事实源；
// 2026-10-23 从 `sandboxExecutionSignal` 下沉以断开 madge 静态环）
import { readSandboxPermissionLevel } from './permissionLevel';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('sandbox\WorkspaceManager');

const WORKSPACE_MODULE = 'WorkspaceManager';

/**
 * 工作空间创建选项
 */
export interface WorkspaceCreateOptions {
  /** 沙箱平台 */
  platform?: SandboxPlatform;
  /** 工作目录 */
  workingDirectory?: string;
  /** 最大执行时间（毫秒） */
  maxExecutionTime?: number;
  /** SSH 配置（仅 SSH 工作空间需要） */
  sshConfig?: SSHSandboxConfig;
  /** 权限列表 */
  permissions?: SandboxPermission[];
  /**
   * 适配器专有配置（2026-10-23，方案 A）：例如 Docker 的
   * `DOCKER_CONFIG_KEYS.VOLUMES`（宿主工作区 → 容器路径的挂载，`fileIoMount()` 的取证来源）。
   */
  customConfig?: Record<string, unknown>;
}

/**
 * 工作空间管理器
 * 支持按平台和配置创建对应的工作空间实例
 */
export class WorkspaceManager {
  private readonly workspaces: Map<string, WorkspaceBase> = new Map();

  /**
   * 创建工作空间
   * @param id 工作空间标识
   * @param options 创建选项
   * @returns 工作空间实例
   */
  async create(
    id: string,
    options: WorkspaceCreateOptions = {}
  ): Promise<WorkspaceBase> {
    if (this.workspaces.has(id)) {
      throw new AppError(
        `工作空间已存在: ${id}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        undefined,
        { module: WORKSPACE_MODULE, context: { workspaceId: id } }
      );
    }

    const config = this.buildConfig(options);
    const workspace = this.createAdapter(config, options);
    await workspace.initialize();
    this.workspaces.set(id, workspace);
    return workspace;
  }

  /**
   * **同步**创建工作空间（不调用 `initialize()`）
   *
   * 仅用于「按身份惰性建默认工作区」这类**同步读取路径**（权限判定 / 状态查询）：
   * 该路径拿不到 `await` 的机会，而 `WorkspaceBase.initialize()` 是基类空实现、
   * 三个适配器（Local / Docker / SSH）**均未覆写** ⇒ 创建过程本身无 IO，同步完成安全。
   *
   * 其他场景仍走 `create()` —— 保留 `initialize()` 的语义位置，避免"以后有人给适配器
   * 加了 IO 初始化"时被本方法静默跳过。
   */
  createSync(id: string, options: WorkspaceCreateOptions = {}): WorkspaceBase {
    if (this.workspaces.has(id)) {
      throw new AppError(
        `工作空间已存在: ${id}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        undefined,
        { module: WORKSPACE_MODULE, context: { workspaceId: id } }
      );
    }
    const config = this.buildConfig(options);
    const workspace = this.createAdapter(config, options);
    this.workspaces.set(id, workspace);
    return workspace;
  }

  /**
   * 获取已创建的工作空间
   */
  get(id: string): WorkspaceBase | undefined {
    return this.workspaces.get(id);
  }

  /**
   * 关闭并移除工作空间
   */
  async close(id: string): Promise<boolean> {
    const workspace = this.workspaces.get(id);
    if (!workspace) return false;

    await workspace.close();
    return this.workspaces.delete(id);
  }

  /**
   * 获取所有工作空间
   */
  list(): Map<string, WorkspaceBase> {
    return new Map(this.workspaces);
  }

  /**
   * 关闭所有工作空间
   */
  async closeAll(): Promise<void> {
    for (const [id, workspace] of this.workspaces) {
      await workspace.close();
      this.workspaces.delete(id);
    }
  }

  /**
   * 检查工作空间是否存在
   */
  has(id: string): boolean {
    return this.workspaces.has(id);
  }

  /**
   * 构建沙箱配置
   */
  private buildConfig(options: WorkspaceCreateOptions): SandboxConfig {
    return {
      platform: options.platform || this.detectPlatform(),
      allowedPermissions: options.permissions || this.getDefaultPermissions(),
      filesystemWhitelist: [],
      networkWhitelist: [],
      environmentWhitelist: [],
      maxExecutionTime: options.maxExecutionTime || 30000,
      maxMemory: 256,
      workingDirectory: options.workingDirectory || process.cwd(),
      ...(options.customConfig ? { customConfig: options.customConfig } : {}),
    };
  }

  /**
   * 沙箱默认权限策略（配置化；**默认 `standard`**，2026-10-23 拍板）
   *
   * 优先级：config.json sandbox.permissionLevel（S1 管理页可配置）
   *       → 环境变量 PERMISSION_SANDBOX_DEFAULT（启动时注入）
   *       → 默认 `standard`
   * - `full`     = READ_FILE + WRITE_FILE + EXECUTE
   * - `standard` = READ_FILE + WRITE_FILE（去掉 EXECUTE；**现默认**，见 Q-30）
   * - `readonly` = READ_FILE（仅可读，最严格）
   *
   * 为什么收窄：默认 `full` 时"沙箱内放行"等于允许任意执行 ⇒ 隔离形同虚设（§3.9.4 S3）。
   * 取值解析与默认值**单一事实源**在 `./sandboxExecutionSignal`（本文件只做权限位映射）；
   * 单工作区仍可通过 options.permissions 覆盖。
   */
  private getDefaultPermissions(): SandboxPermission[] {
    const policy = readSandboxPermissionLevel();
    switch (policy) {
      case 'readonly':
        return [SandboxPermission.READ_FILE];
      case 'standard':
        return [SandboxPermission.READ_FILE, SandboxPermission.WRITE_FILE];
      case 'full':
      default:
        return [
          SandboxPermission.READ_FILE,
          SandboxPermission.WRITE_FILE,
          SandboxPermission.EXECUTE,
        ];
    }
  }

  /**
   * 根据配置选择适配器
   */
  private createAdapter(
    config: SandboxConfig,
    options: WorkspaceCreateOptions
  ): WorkspaceBase {
    if (options.sshConfig) {
      return new SSHWorkspace(config, options.sshConfig);
    }

    switch (config.platform) {
      case SandboxPlatform.LINUX:
        // 有 Docker 时优先使用 Docker
        return new DockerWorkspace(config);
      case SandboxPlatform.WINDOWS:
      case SandboxPlatform.MACOS:
      case SandboxPlatform.UNKNOWN:
      default:
        return new LocalWorkspace(config);
    }
  }

  /**
   * 检测当前平台
   */
  private detectPlatform(): SandboxPlatform {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return SandboxPlatform.WINDOWS;
      case 'linux':
        return SandboxPlatform.LINUX;
      case 'darwin':
        return SandboxPlatform.MACOS;
      default:
        return SandboxPlatform.UNKNOWN;
    }
  }
}

/**
 * 全局工作空间管理器实例
 */
export const globalWorkspaceManager = new WorkspaceManager();
