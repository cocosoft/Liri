/**
 * WorkspaceBase 工作空间抽象类
 * 提供统一的工作空间操作接口，包装现有的 Sandbox 实现
 * 对标 AgentScope WorkspaceBase 设计模式（适配器模式）
 */

import {
  SandboxConfig,
  SandboxExecuteOptions,
  SandboxExecuteResult,
  SandboxPermission,
  SandboxPlatform,
} from './SandboxTypes';

/**
 * 工作空间文件信息
 */
export interface WorkspaceFileInfo {
  /** 文件路径 */
  path: string;
  /** 文件大小（字节） */
  size: number;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 修改时间 */
  modifiedAt: Date;
  /** 权限字符串（如 rwxr-xr-x） */
  permissions?: string;
  /** 所有者 */
  owner?: string;
}

/**
 * 工作空间资源列表
 */
export interface WorkspaceListResult {
  /** 资源列表 */
  files: WorkspaceFileInfo[];
  /** 是否已截断（当文件数超过限制时） */
  truncated: boolean;
  /** 总文件数 */
  totalCount: number;
}

/**
 * 工作空间抽象类
 * 适配器模式：提供统一的工作空间接口
 * 每个适配器自行管理底层沙箱实例
 *
 * @example
 * ```typescript
 * class DockerWorkspace extends WorkspaceBase {
 *   private readonly dockerSandbox: DockerSandbox;
 *
 *   constructor(config: SandboxConfig) {
 *     super(config);
 *     this.dockerSandbox = new DockerSandbox();
 *   }
 * }
 * ```
 */
export abstract class WorkspaceBase {
  /** 沙箱配置 */
  protected readonly config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  /**
   * 读取文件内容
   * @param path 文件路径
   * @returns 文件内容
   */
  abstract readFile(path: string): Promise<string>;

  /**
   * 写入文件内容
   * @param path 文件路径
   * @param content 文件内容
   */
  abstract writeFile(path: string, content: string): Promise<void>;

  /**
   * 列出工作空间资源
   * @param path 目录路径（默认工作目录）
   * @param options 选项
   */
  abstract listResources(
    path?: string,
    options?: { maxResults?: number; recursive?: boolean }
  ): Promise<WorkspaceListResult>;

  /**
   * 执行命令
   * @param command 命令
   * @param options 执行选项
   * @returns 执行结果
   */
  abstract execute(
    command: string,
    options?: Partial<SandboxExecuteOptions>
  ): Promise<SandboxExecuteResult>;

  /**
   * 初始化工作空间
   */
  async initialize(): Promise<boolean> {
    return true;
  }

  /**
   * 关闭工作空间
   */
  async close(): Promise<boolean> {
    return true;
  }

  /**
   * 获取工作空间状态
   */
  getStatus(): {
    isInitialized: boolean;
    platform: SandboxPlatform;
    config: SandboxConfig;
  } {
    return {
      isInitialized: true,
      platform: SandboxPlatform.UNKNOWN,
      config: this.config,
    };
  }

  /**
   * 检查权限
   */
  hasPermission(permission: SandboxPermission): boolean {
    return this.config.allowedPermissions.includes(permission);
  }

  /**
   * 本工作区的**隔离形态**（2026-10-23，方案 A 取证用）。
   *
   * - `local`：宿主进程直接操作文件系统（**不是隔离**，仅路径/权限位约束）；
   * - `container` / `ssh`：文件读写经容器或远端执行 ⇒ 外部可证"操作确实落在隔离环境内"。
   *
   * 消费点：`sandbox/workspaceIsolation` → `PermissionChecker` 的沙箱豁免（S1）。
   * 默认 `local`（fail-closed：未覆写者一律视为未隔离）。
   */
  isolationMode(): 'local' | 'container' | 'ssh' {
    return 'local';
  }

  /**
   * **宿主工作区根 ↔ 隔离环境内根**的挂载映射（2026-10-23，方案 A 路由用）。
   *
   * `isolationMode()` 只回答"是不是隔离环境"；本方法回答"宿主路径能落到环境内哪"。
   * 两者缺一，文件类工具都**不得**声称隔离：
   * - 无映射 ⇒ 无法把工具解析出的宿主绝对路径翻译成环境内路径 ⇒ 不路由（保持宿主直写）；
   * - `LocalWorkspace` / 未声明者一律 `null`（fail-closed）。
   *
   * 消费点：`sandbox/workspaceIsolation`（路由 + `fileIoIsolated` 取证）。
   */
  fileIoMount(): { hostRoot: string; isolatedRoot: string } | null {
    return null;
  }
}
