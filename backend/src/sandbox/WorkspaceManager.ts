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
} from './types/SandboxTypes';
import type { SSHSandboxConfig } from './SSHSandbox';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

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
      allowedPermissions: options.permissions || [
        SandboxPermission.READ_FILE,
        SandboxPermission.WRITE_FILE,
        SandboxPermission.EXECUTE,
      ],
      filesystemWhitelist: [],
      networkWhitelist: [],
      environmentWhitelist: [],
      maxExecutionTime: options.maxExecutionTime || 30000,
      maxMemory: 256,
      workingDirectory: options.workingDirectory || process.cwd(),
    };
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
