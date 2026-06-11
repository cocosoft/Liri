/**
 * 沙箱系统类型定义
 * 定义沙箱相关的接口和类型
 */

/**
 * 沙箱平台类型
 */
export enum SandboxPlatform {
  /** Windows 平台 */
  WINDOWS = 'windows',
  /** Linux 平台 */
  LINUX = 'linux',
  /** macOS 平台 */
  MACOS = 'darwin',
  /** 未知平台 */
  UNKNOWN = 'unknown',
}

/**
 * 沙箱权限类型
 */
export enum SandboxPermission {
  /** 读取文件权限 */
  READ_FILE = 'read_file',
  /** 写入文件权限 */
  WRITE_FILE = 'write_file',
  /** 执行命令权限 */
  EXECUTE = 'execute',
  /** 网络访问权限 */
  NETWORK = 'network',
  /** 环境变量访问权限 */
  ENVIRONMENT = 'environment',
  /** 进程创建权限 */
  CREATE_PROCESS = 'create_process',
  /** 系统调用权限 */
  SYSTEM_CALL = 'system_call',
}

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /** 沙箱平台 */
  platform: SandboxPlatform;
  /** 允许的权限列表 */
  allowedPermissions: SandboxPermission[];
  /** 文件系统白名单 */
  filesystemWhitelist: string[];
  /** 网络访问白名单 */
  networkWhitelist: string[];
  /** 环境变量白名单 */
  environmentWhitelist: string[];
  /** 最大执行时间（毫秒） */
  maxExecutionTime: number;
  /** 最大内存使用（MB） */
  maxMemory: number;
  /** 工作目录 */
  workingDirectory?: string;
  /** 自定义配置 */
  customConfig?: Record<string, unknown>;
}

/**
 * 沙箱执行选项
 */
export interface SandboxExecuteOptions {
  /** 命令参数 */
  args: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 输入数据 */
  input?: string;
  /** 是否捕获输出 */
  captureOutput?: boolean;
}

/**
 * 沙箱执行结果
 */
export interface SandboxExecuteResult {
  /** 执行是否成功 */
  success: boolean;
  /** 退出代码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 执行时间（毫秒） */
  executionTime: number;
  /** 执行时间（毫秒） - 别名 */
  durationMs?: number;
  /** 是否超时 */
  timedOut?: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 沙箱接口
 */
export interface Sandbox {
  /**
   * 初始化沙箱
   * @param config 沙箱配置
   * @returns 初始化结果
   */
  initialize(config: SandboxConfig): Promise<boolean>;

  /**
   * 执行命令
   * @param options 执行选项
   * @returns 执行结果
   */
  execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult>;

  /**
   * 关闭沙箱
   * @returns 关闭结果
   */
  close(): Promise<boolean>;

  /**
   * 获取沙箱状态
   * @returns 沙箱状态
   */
  getStatus(): {
    isInitialized: boolean;
    platform: SandboxPlatform;
    config: SandboxConfig;
  };

  /**
   * 检查权限
   * @param permission 权限类型
   * @returns 是否拥有权限
   */
  hasPermission(permission: SandboxPermission): boolean;

  /**
   * 添加文件系统白名单
   * @param path 文件路径
   * @returns 添加结果
   */
  addFilesystemWhitelist(path: string): boolean;

  /**
   * 添加网络访问白名单
   * @param host 主机名或IP
   * @returns 添加结果
   */
  addNetworkWhitelist(host: string): boolean;

  /**
   * 添加环境变量白名单
   * @param envVar 环境变量名
   * @returns 添加结果
   */
  addEnvironmentWhitelist(envVar: string): boolean;
}

/**
 * 沙箱管理器接口
 */
export interface SandboxManager {
  /**
   * 创建沙箱实例
   * @param config 沙箱配置
   * @returns 沙箱实例
   */
  createSandbox(config: SandboxConfig): Sandbox;

  /**
   * 获取当前平台
   * @returns 平台类型
   */
  getCurrentPlatform(): SandboxPlatform;

  /**
   * 检查平台是否支持
   * @param platform 平台类型
   * @returns 是否支持
   */
  isPlatformSupported(platform: SandboxPlatform): boolean;

  /**
   * 获取平台支持的权限列表
   * @param platform 平台类型
   * @returns 支持的权限列表
   */
  getSupportedPermissions(platform: SandboxPlatform): SandboxPermission[];

  /**
   * 创建默认配置
   * @param platform 平台类型
   * @returns 默认配置
   */
  createDefaultConfig(platform: SandboxPlatform): SandboxConfig;
}

/**
 * 创建默认沙箱配置
 * @param platform 平台类型
 * @param overrides 配置覆盖
 * @returns 沙箱配置
 */
export function createDefaultSandboxConfig(
  platform: SandboxPlatform,
  overrides?: Partial<SandboxConfig>
): SandboxConfig {
  const defaultConfig: SandboxConfig = {
    platform,
    allowedPermissions: [SandboxPermission.READ_FILE],
    filesystemWhitelist: [],
    networkWhitelist: [],
    environmentWhitelist: [],
    maxExecutionTime: 30000, // 30秒
    maxMemory: 256, // 256MB
  };

  return {
    ...defaultConfig,
    ...overrides,
  };
}

/**
 * 创建沙箱执行选项
 * @param args 命令参数
 * @param options 选项覆盖
 * @returns 沙箱执行选项
 */
export function createSandboxExecuteOptions(
  args: string[],
  options?: Partial<SandboxExecuteOptions>
): SandboxExecuteOptions {
  const defaultOptions: SandboxExecuteOptions = {
    args,
    env: {},
    cwd: process.cwd(),
    timeout: 30000,
    captureOutput: true,
  };

  return {
    ...defaultOptions,
    ...options,
  };
}

/**
 * 沙箱文件系统配置
 */
export interface SandboxFilesystemConfig {
  allowRead?: string[];
  denyRead?: string[];
  allowWrite?: string[];
  denyWrite?: string[];
  allowManagedReadPathsOnly?: boolean;
}

/**
 * 沙箱网络配置
 */
export interface SandboxNetworkConfig {
  allowedDomains?: string[];
}

/**
 * 沙箱设置
 */
export interface SandboxSettings {
  enabled?: boolean;
  allowUnsandboxedCommands?: boolean;
  excludedCommands?: string[];
  filesystem?: SandboxFilesystemConfig;
  network?: SandboxNetworkConfig;
}

/**
 * 沙箱约束
 */
export interface SandboxConstraints {
  allowedPaths?: string[];
  deniedPaths?: string[];
  maxExecutionTimeMs?: number;
  maxOutputSizeBytes?: number;
  maxMemoryMB?: number;
}

/**
 * 沙箱检查结果
 */
export interface SandboxCheckResult {
  allowed: boolean;
  reason: string;
  matchedPattern?: string;
}

/**
 * 沙箱违规事件
 */
export interface SandboxViolationEvent {
  type: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * 创建默认沙箱设置
 * @returns 沙箱设置
 */
export function createDefaultSandboxSettings(): SandboxSettings {
  return {
    enabled: true,
    allowUnsandboxedCommands: true,
    excludedCommands: [],
    filesystem: {
      allowRead: [],
      denyRead: [],
      allowWrite: [],
      denyWrite: [],
      allowManagedReadPathsOnly: false,
    },
    network: {
      allowedDomains: [],
    },
  };
}

/**
 * 创建默认沙箱约束
 * @returns 沙箱约束
 */
export function createDefaultSandboxConstraints(): SandboxConstraints {
  return {
    allowedPaths: [],
    deniedPaths: [],
    maxExecutionTimeMs: 30000,
    maxOutputSizeBytes: 1048576, // 1MB
    maxMemoryMB: 256,
  };
}

/**
 * 文件系统访问规则（细粒度权限）
 * 对标 Codex FSAccessRule 的细化控制
 */
export interface FSAccessRule {
  path: string;
  permissions: ('read' | 'write' | 'execute')[];
  recursive: boolean;
}

/**
 * 沙箱权限集（细粒度容器配置）
 * 替代原有的 filesystemWhitelist: string[]，提供结构化控制
 */
export interface SandboxPermissions {
  filesystem: FSAccessRule[];
  network: boolean;
  networkWhitelist: string[];
  process: boolean;
  bwrap: boolean;
  memoryLimitMb?: number;
  cpuQuota?: number;
  timeoutMs?: number;
}

/**
 * Bash 权限规则类型
 */
export interface BashPermissionRule {
  type: 'exact' | 'wildcard' | 'prefix';
  command?: string;
  pattern?: string;
  prefix?: string;
}
