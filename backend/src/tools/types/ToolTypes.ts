/**
 * 工具系统类型定义（基于CC源码）
 * 定义工具系统的基础类型和接口
 */

/**
 * 工具定义接口（基于CC源码）
 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;

  /** 工具描述 */
  description: string;

  /** 工具版本 */
  version?: string;

  /** 工具作者 */
  author?: string;

  /** 工具分类 */
  category?: string;

  /** 工具标签 */
  tags?: string[];

  /** 工具输入参数定义 */
  parameters?: ToolParameter[];

  /** 工具输出定义 */
  returns?: ToolReturn;

  /** 工具权限要求 */
  permissions?: ToolPermission[];

  /** 工具执行超时时间（毫秒） */
  timeout?: number;

  /** 工具是否启用 */
  enabled?: boolean;

  /** 工具配置 */
  config?: Record<string, unknown>;
}

/**
 * 工具参数定义（基于CC源码）
 */
export interface ToolParameter {
  /** 参数名称 */
  name: string;

  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** 参数描述 */
  description: string;

  /** 参数是否必需 */
  required?: boolean;

  /** 参数默认值 */
  default?: unknown;

  /** 参数验证规则 */
  validation?: ToolParameterValidation;

  /** 参数选项（用于枚举类型） */
  options?: string[];
}

/**
 * 工具参数验证（基于CC源码）
 */
export interface ToolParameterValidation {
  /** 最小值（数字类型） */
  min?: number;

  /** 最大值（数字类型） */
  max?: number;

  /** 最小长度（字符串/数组类型） */
  minLength?: number;

  /** 最大长度（字符串/数组类型） */
  maxLength?: number;

  /** 正则表达式模式（字符串类型） */
  pattern?: string;

  /** 自定义验证函数 */
  validator?: (value: unknown) => boolean;
}

/**
 * 工具返回定义（基于CC源码）
 */
export interface ToolReturn {
  /** 返回类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'void';

  /** 返回描述 */
  description: string;

  /** 返回示例 */
  example?: unknown;
}

/**
 * 工具权限定义（基于CC源码）
 */
export interface ToolPermission {
  /** 权限类型 */
  type: 'file' | 'network' | 'process' | 'system' | 'custom';

  /** 权限描述 */
  description: string;

  /** 权限范围 */
  scope?: string;

  /** 权限级别 */
  level: 'read' | 'write' | 'execute' | 'admin';
}

/**
 * 工具执行上下文（基于CC源码）
 */
export interface ToolExecutionContext {
  /** 执行ID */
  executionId: string;

  /** 用户ID */
  userId: string;

  /** 会话ID */
  sessionId: string;

  /** 工作目录 */
  workingDirectory: string;

  /** 环境变量 */
  environment: Record<string, string>;

  /** 输入参数 */
  parameters: Record<string, unknown>;

  /** 工具配置 */
  config: Record<string, unknown>;

  /** 执行选项 */
  options: ToolExecutionOptions;
}

/**
 * 工具执行选项（基于CC源码）
 */
export interface ToolExecutionOptions {
  /** 执行超时时间（毫秒） */
  timeout?: number;

  /** 是否启用缓存 */
  cacheEnabled?: boolean;

  /** 缓存过期时间（毫秒） */
  cacheExpiry?: number;

  /** 是否启用重试 */
  retryEnabled?: boolean;

  /** 最大重试次数 */
  maxRetries?: number;

  /** 重试延迟（毫秒） */
  retryDelay?: number;

  /** 是否启用日志记录 */
  loggingEnabled?: boolean;

  /** 日志级别 */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /** 是否启用性能监控 */
  monitoringEnabled?: boolean;
}

/**
 * 工具执行结果（基于CC源码）
 */
export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean;

  /** 执行输出 */
  output?: unknown;

  /** 错误信息 */
  error?: string;

  /** 错误代码 */
  errorCode?: string;

  /** 执行时间（毫秒） */
  executionTime: number;

  /** 开始时间 */
  startTime: Date;

  /** 结束时间 */
  endTime: Date;

  /** 执行统计 */
  stats: ToolExecutionStats;

  /** 执行日志 */
  logs: ToolExecutionLog[];
}

/**
 * 工具执行统计（基于CC源码）
 */
export interface ToolExecutionStats {
  /** 内存使用量（字节） */
  memoryUsage?: number;

  /** CPU使用率（百分比） */
  cpuUsage?: number;

  /** 网络使用量（字节） */
  networkUsage?: number;

  /** 磁盘使用量（字节） */
  diskUsage?: number;

  /** 执行次数 */
  executionCount?: number;

  /** 平均执行时间（毫秒） */
  averageExecutionTime?: number;

  /** 成功率（百分比） */
  successRate?: number;

  /** 成功执行次数 */
  successfulExecutions?: number;

  /** 失败执行次数 */
  failedExecutions?: number;

  /** 总执行时间（毫秒） */
  totalExecutionTime?: number;

  /** 并发执行数 */
  concurrentExecutions?: number;
}

/**
 * 工具执行日志（基于CC源码）
 */
export interface ToolExecutionLog {
  /** 日志时间 */
  timestamp: Date;

  /** 日志级别 */
  level: 'debug' | 'info' | 'warn' | 'error';

  /** 日志消息 */
  message: string;

  /** 日志数据 */
  data?: unknown;
}

/**
 * 工具注册信息（基于CC源码）
 */
export interface ToolRegistration {
  /** 工具定义 */
  definition: ToolDefinition;

  /** 工具实现函数 */
  implementation: ToolImplementation;

  /** 工具状态 */
  status: 'registered' | 'enabled' | 'disabled' | 'error';

  /** 注册时间 */
  registeredAt: Date;

  /** 最后更新时间 */
  updatedAt: Date;

  /** 工具统计 */
  stats: ToolStats;
}

/**
 * 工具实现函数（基于CC源码）
 */
export type ToolImplementation = (
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>;

/**
 * 工具统计信息（基于CC源码）
 */
export interface ToolStats {
  /** 总执行次数 */
  totalExecutions: number;

  /** 成功执行次数 */
  successfulExecutions: number;

  /** 失败执行次数 */
  failedExecutions: number;

  /** 总执行时间（毫秒） */
  totalExecutionTime: number;

  /** 平均执行时间（毫秒） */
  averageExecutionTime: number;

  /** 最后执行时间 */
  lastExecutionTime?: Date;

  /** 最后执行结果 */
  lastExecutionResult?: ToolExecutionResult;
}

/**
 * 工具管理器配置（基于CC源码）
 */
export interface ToolManagerConfig {
  /** 工具注册表路径 */
  registryPath?: string;

  /** 工具缓存配置 */
  cache?: ToolCacheConfig;

  /** 工具执行配置 */
  execution?: ToolExecutionConfig;

  /** 工具监控配置 */
  monitoring?: ToolMonitoringConfig;

  /** 工具安全配置 */
  security?: ToolSecurityConfig;

  /** 工具日志配置 */
  logging?: ToolLoggingConfig;
}

/**
 * 工具缓存配置（基于CC源码）
 */
export interface ToolCacheConfig {
  /** 是否启用缓存 */
  enabled: boolean;

  /** 缓存最大大小 */
  maxSize: number;

  /** 缓存过期时间（毫秒） */
  expiry: number;

  /** 缓存存储路径 */
  storagePath?: string;
}

/**
 * 工具执行配置（基于CC源码）
 */
export interface ToolExecutionConfig {
  /** 默认执行超时时间（毫秒） */
  defaultTimeout: number;

  /** 最大并发执行数 */
  maxConcurrent: number;

  /** 是否启用重试 */
  retryEnabled: boolean;

  /** 最大重试次数 */
  maxRetries: number;

  /** 重试延迟（毫秒） */
  retryDelay: number;
}

/**
 * 工具监控配置（基于CC源码）
 */
export interface ToolMonitoringConfig {
  /** 是否启用监控 */
  enabled: boolean;

  /** 监控数据保留时间（毫秒） */
  retention: number;

  /** 监控指标采样间隔（毫秒） */
  samplingInterval: number;

  /** 监控告警配置 */
  alerts: ToolAlertConfig[];
}

/**
 * 工具安全配置（基于CC源码）
 */
export interface ToolSecurityConfig {
  /** 是否启用安全检查 */
  enabled: boolean;

  /** 权限验证配置 */
  permission: ToolPermissionConfig;

  /** 输入验证配置 */
  validation: ToolValidationConfig;

  /** 沙箱配置 */
  sandbox: ToolSandboxConfig;
}

/**
 * 工具日志配置（基于CC源码）
 */
export interface ToolLoggingConfig {
  /** 是否启用日志记录 */
  enabled: boolean;

  /** 日志级别 */
  level: 'debug' | 'info' | 'warn' | 'error';

  /** 日志文件路径 */
  filePath?: string;

  /** 日志最大大小（字节） */
  maxSize: number;

  /** 日志保留天数 */
  retentionDays: number;
}

/**
 * 工具告警配置（基于CC源码）
 */
export interface ToolAlertConfig {
  /** 告警名称 */
  name: string;

  /** 告警条件 */
  condition: (stats: ToolExecutionStats) => boolean;

  /** 告警级别 */
  level: 'info' | 'warning' | 'error' | 'critical';

  /** 告警消息 */
  message: string;

  /** 告警动作 */
  actions: ToolAlertAction[];
}

/**
 * 工具告警动作（基于CC源码）
 */
export interface ToolAlertAction {
  /** 动作类型 */
  type: 'log' | 'notify' | 'disable' | 'restart';

  /** 动作配置 */
  config: Record<string, unknown>;
}

/**
 * 工具权限配置（基于CC源码）
 */
export interface ToolPermissionConfig {
  /** 权限验证模式 */
  mode: 'strict' | 'permissive' | 'custom';

  /** 默认权限级别 */
  defaultLevel: 'read' | 'write' | 'execute';

  /** 权限规则 */
  rules: ToolPermissionRule[];
}

/**
 * 工具验证配置（基于CC源码）
 */
export interface ToolValidationConfig {
  /** 输入验证模式 */
  mode: 'strict' | 'permissive' | 'custom';

  /** 验证规则 */
  rules: ToolValidationRule[];
}

/**
 * 工具沙箱配置（基于CC源码）
 */
export interface ToolSandboxConfig {
  /** 是否启用沙箱 */
  enabled: boolean;

  /** 沙箱类型 */
  type: 'process' | 'container' | 'vm';

  /** 沙箱配置 */
  config: Record<string, unknown>;
}

/**
 * 工具权限规则（基于CC源码）
 */
export interface ToolPermissionRule {
  /** 规则名称 */
  name: string;

  /** 规则条件 */
  condition: (context: ToolExecutionContext) => boolean;

  /** 允许的权限 */
  allowedPermissions: ToolPermission[];

  /** 拒绝的权限 */
  deniedPermissions: ToolPermission[];
}

/**
 * 工具验证规则（基于CC源码）
 */
export interface ToolValidationRule {
  /** 规则名称 */
  name: string;

  /** 验证字段 */
  field: string;

  /** 验证条件 */
  condition: (value: unknown) => boolean;

  /** 错误消息 */
  errorMessage: string;
}

/**
 * 工具事件类型（基于CC源码）
 */
export enum ToolEventType {
  /** 工具注册 */
  TOOL_REGISTERED = 'tool.registered',

  /** 工具注销 */
  TOOL_UNREGISTERED = 'tool.unregistered',

  /** 工具启用 */
  TOOL_ENABLED = 'tool.enabled',

  /** 工具禁用 */
  TOOL_DISABLED = 'tool.disabled',

  /** 工具执行开始 */
  TOOL_EXECUTION_STARTED = 'tool.execution.started',

  /** 工具执行成功 */
  TOOL_EXECUTION_SUCCESS = 'tool.execution.success',

  /** 工具执行失败 */
  TOOL_EXECUTION_FAILED = 'tool.execution.failed',

  /** 工具执行超时 */
  TOOL_EXECUTION_TIMEOUT = 'tool.execution.timeout',

  /** 工具执行取消 */
  TOOL_EXECUTION_CANCELLED = 'tool.execution.cancelled',
}

/**
 * 工具事件数据（基于CC源码）
 */
export interface ToolEventData {
  /** 工具名称 */
  toolName: string;

  /** 事件时间 */
  timestamp: Date;

  /** 事件数据 */
  data: Record<string, unknown>;
}

/**
 * 工具系统版本信息（基于CC源码）
 */
export const TOOL_SYSTEM_VERSION = '1.0.0';

/**
 * 默认工具配置（基于CC源码）
 */
export const DEFAULT_TOOL_CONFIG: ToolManagerConfig = {
  cache: {
    enabled: true,
    maxSize: 1000,
    expiry: 300000, // 5分钟
  },
  execution: {
    defaultTimeout: 30000, // 30秒
    maxConcurrent: 10,
    retryEnabled: true,
    maxRetries: 3,
    retryDelay: 1000, // 1秒
  },
  monitoring: {
    enabled: true,
    retention: 86400000, // 1天
    samplingInterval: 60000, // 1分钟
    alerts: [],
  },
  security: {
    enabled: true,
    permission: {
      mode: 'strict',
      defaultLevel: 'read',
      rules: [],
    },
    validation: {
      mode: 'strict',
      rules: [],
    },
    sandbox: {
      enabled: false,
      type: 'process',
      config: {},
    },
  },
  logging: {
    enabled: true,
    level: 'info',
    maxSize: 10485760, // 10MB
    retentionDays: 7,
  },
};

/**
 * 工具系统错误代码（基于CC源码）
 */
export enum ToolErrorCode {
  /** 工具未找到 */
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',

  /** 工具已存在 */
  TOOL_ALREADY_EXISTS = 'TOOL_ALREADY_EXISTS',

  /** 工具未启用 */
  TOOL_DISABLED = 'TOOL_DISABLED',

  /** 权限不足 */
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

  /** 参数验证失败 */
  PARAMETER_VALIDATION_FAILED = 'PARAMETER_VALIDATION_FAILED',

  /** 执行超时 */
  EXECUTION_TIMEOUT = 'EXECUTION_TIMEOUT',

  /** 执行失败 */
  EXECUTION_FAILED = 'EXECUTION_FAILED',

  /** 缓存错误 */
  CACHE_ERROR = 'CACHE_ERROR',

  /** 监控错误 */
  MONITORING_ERROR = 'MONITORING_ERROR',

  /** 安全错误 */
  SECURITY_ERROR = 'SECURITY_ERROR',
}
