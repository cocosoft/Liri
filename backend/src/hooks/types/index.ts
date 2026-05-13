//
/**
 * Hooks系统类型定义（基于CC源码实现）
 * 定义Hook事件、上下文、结果、优先级等核心类型
 */

/**
 * Hook事件类型（基于CC源码）
 */
export type HookEvent =
  | 'system.startup'
  | 'system.shutdown'
  | 'session.start'
  | 'session.end'
  | 'compression.pre'
  | 'compression.post'
  | 'memory.pre-save'
  | 'memory.post-save'
  | 'memory.pre-load'
  | 'memory.post-load'
  | 'skill.pre-execute'
  | 'skill.post-execute'
  | 'command.pre-execute'
  | 'command.post-execute'
  | 'tool.pre-use'
  | 'tool.post-use'
  | 'plugin.pre-load'
  | 'plugin.post-load'
  | 'file.pre-read'
  | 'file.post-read'
  | 'file.pre-write'
  | 'file.post-write'
  | 'http.pre-request'
  | 'http.post-response'
  | 'error.pre-handle'
  | 'error.post-handle'
  | 'cost.alert'
  | 'cost.budget.warning'
  | 'cost.budget.exceeded'
  | string; // 支持自定义事件

/**
 * Hook优先级（基于CC源码）
 */
export type HookPriority = 'highest' | 'high' | 'normal' | 'low' | 'lowest';

/**
 * Hook依赖关系（基于CC源码）
 */
export interface HookDependency {
  /**
   * 依赖的Hook ID
   */
  hookId: string;

  /**
   * 要求的版本
   */
  requiredVersion?: string;

  /**
   * 是否必需
   */
  required?: boolean;
}

/**
 * Hook定义接口（基于CC源码）
 */
export interface HookDefinition {
  /**
   * Hook名称
   */
  name: string;

  /**
   * Hook事件类型
   */
  event: HookEvent;

  /**
   * Hook描述
   */
  description: string;

  /**
   * Hook版本
   */
  version?: string;

  /**
   * 是否启用
   */
  enabled?: boolean;

  /**
   * Hook优先级
   */
  priority?: HookPriority;

  /**
   * 依赖关系
   */
  dependencies?: HookDependency[];

  /**
   * 匹配器函数（可选）
   */
  matcher?: (context: HookContext) => boolean;

  /**
   * Hook处理器函数
   */
  handler: (context: HookContext) => Promise<HookResult>;

  /**
   * 超时时间（毫秒）
   */
  timeout?: number;

  /**
   * 是否阻止后续Hook执行
   */
  preventContinuation?: boolean;

  /**
   * 错误处理策略
   */
  errorHandling?: 'continue' | 'stop' | 'throw';
}

/**
 * Hook执行上下文（基于CC源码）
 */
export interface HookContext {
  /**
   * Hook事件类型
   */
  event: HookEvent;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 用户ID
   */
  userId?: string;

  /**
   * 工作目录
   */
  workingDirectory?: string;

  /**
   * 事件数据
   */
  data?: unknown;

  /**
   * 工具名称列表
   */
  toolNames?: string[];

  /**
   * 技能名称
   */
  skillName?: string;

  /**
   * 命令名称
   */
  commandName?: string;

  /**
   * 插件名称
   */
  pluginName?: string;

  /**
   * 文件路径
   */
  filePath?: string;

  /**
   * HTTP请求信息
   */
  httpRequest?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  };

  /**
   * HTTP响应信息
   */
  httpResponse?: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
  };

  /**
   * 错误信息
   */
  error?: Error;

  /**
   * 环境变量
   */
  environment?: Record<string, string>;

  /**
   * 安全配置
   */
  securityConfig?: Record<string, unknown>;

  /**
   * 性能配置
   */
  performanceConfig?: Record<string, unknown>;

  /**
   * 扩展数据
   */
  extensions?: Record<string, unknown>;

  /**
   * 匹配器配置
   */
  matcher?: string;

  /**
   * 额外属性
   */
  [key: string]: unknown;
}

/**
 * Hook执行结果（基于CC源码）
 */
export interface HookResult {
  /**
   * 执行是否成功
   */
  success: boolean;

  /**
   * 输出数据
   */
  output?: unknown;

  /**
   * 结果消息
   */
  message?: string;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 退出代码
   */
  exitCode?: number;

  /**
   * 执行时间（毫秒）
   */
  durationMs?: number;

  /**
   * 阻止后续Hook执行
   */
  preventContinuation?: boolean;

  /**
   * 停止执行原因
   */
  stopReason?: string;

  /**
   * 更新的输入数据
   */
  updatedInput?: Record<string, unknown>;

  /**
   * 附加上下文
   */
  additionalContext?: string;

  /**
   * 权限行为
   */
  permissionBehavior?: 'allow' | 'deny' | 'ask';

  /**
   * Hook权限决策原因
   */
  hookPermissionDecisionReason?: string;

  /**
   * 扩展数据
   */
  extensions?: Record<string, unknown>;

  /**
   * 额外属性
   */
  [key: string]: unknown;
}

/**
 * Hook执行器配置（基于CC源码）
 */
export interface HookExecutorConfig {
  /**
   * 默认超时时间（毫秒）
   */
  defaultTimeout?: number;

  /**
   * 最大并发数
   */
  maxConcurrency?: number;

  /**
   * 错误处理策略
   */
  errorHandling?: 'continue' | 'stop' | 'throw';

  /**
   * 是否启用性能监控
   */
  enablePerformanceMonitoring?: boolean;

  /**
   * 是否启用安全检查
   */
  enableSecurityCheck?: boolean;

  /**
   * 是否启用诊断日志
   */
  enableDiagnosticLogging?: boolean;
}

/**
 * Hook执行统计信息（基于CC源码）
 */
export interface HookExecutionStats {
  /**
   * Hook ID
   */
  hookId: string;

  /**
   * 执行次数
   */
  executionCount: number;

  /**
   * 成功次数
   */
  successCount: number;

  /**
   * 失败次数
   */
  failureCount: number;

  /**
   * 平均执行时间（毫秒）
   */
  averageDuration: number;

  /**
   * 最后执行时间
   */
  lastExecutedAt?: Date;

  /**
   * 最后执行结果
   */
  lastResult?: HookResult;
}

/**
 * Hook系统配置（基于CC源码）
 */
export interface HookSystemConfig {
  /**
   * 是否启用Hook系统
   */
  enabled: boolean;

  /**
   * 默认Hook配置
   */
  defaultHooks?: HookDefinition[];

  /**
   * 执行器配置
   */
  executorConfig: HookExecutorConfig;

  /**
   * 事件映射
   */
  eventMappings?: Record<string, HookEvent[]>;

  /**
   * 安全配置
   */
  securityConfig?: Record<string, unknown>;

  /**
   * 性能配置
   */
  performanceConfig?: Record<string, unknown>;
}

/**
 * React Hook类型定义（基于CC源码）
 */
export interface ReactHookDefinition {
  /**
   * Hook名称
   */
  name: string;

  /**
   * Hook描述
   */
  description: string;

  /**
   * Hook依赖项
   */
  dependencies?: unknown[];

  /**
   * Hook实现函数
   */
  implementation: (...args: unknown[]) => unknown;

  /**
   * 是否启用
   */
  enabled?: boolean;

  /**
   * 错误处理函数
   */
  errorHandler?: (error: Error) => void;
}

/**
 * 权限Hook上下文（基于CC源码）
 */
export interface PermissionHookContext extends HookContext {
  /**
   * 权限模式
   */
  permissionMode: string;

  /**
   * 工具使用确认
   */
  toolUseConfirm?: unknown;

  /**
   * 权限更新
   */
  permissionUpdates?: unknown[];

  /**
   * 分类器检查结果
   */
  classifierCheck?: unknown;
}

/**
 * 权限Hook结果（基于CC源码）
 */
export interface PermissionHookResult extends HookResult {
  /**
   * 权限决策
   */
  permissionDecision?: 'allow' | 'deny' | 'ask';

  /**
   * 权限决策原因
   */
  permissionDecisionReason?: string;

  /**
   * 需要确认
   */
  requiresConfirmation?: boolean;

  /**
   * 确认消息
   */
  confirmationMessage?: string;
}

/**
 * 压缩Hook上下文（基于CC源码）
 */
export interface CompressionHookContext extends HookContext {
  /**
   * 压缩前内容
   */
  preCompressionContent: string;

  /**
   * 压缩后内容
   */
  postCompressionContent?: string;

  /**
   * 压缩配置
   */
  compressionConfig: Record<string, unknown>;

  /**
   * 压缩统计
   */
  compressionStats?: Record<string, unknown>;
}

/**
 * 压缩Hook结果（基于CC源码）
 */
export interface CompressionHookResult extends HookResult {
  /**
   * 修改后的内容
   */
  modifiedContent?: string;

  /**
   * 压缩建议
   */
  compressionSuggestions?: string[];

  /**
   * 压缩优化
   */
  compressionOptimizations?: Record<string, unknown>;
}

/**
 * 单个Hook配置（基于CC源码）
 */
export interface IndividualHookConfig {
  /**
   * Hook ID
   */
  id: string;

  /**
   * Hook名称
   */
  name: string;

  /**
   * Hook事件类型
   */
  event: HookEvent;

  /**
   * 是否启用
   */
  enabled: boolean;

  /**
   * Hook优先级
   */
  priority: HookPriority;

  /**
   * 匹配器配置
   */
  matcher?: MatcherMetadata;

  /**
   * 执行器类型
   */
  executor?: string;

  /**
   * 执行器配置
   */
  executorConfig?: Record<string, unknown>;

  /**
   * Hook配置
   */
  config: Record<string, unknown>;

  /**
   * 额外属性
   */
  [key: string]: unknown;
}

/**
 * Hook执行上下文
 */
export type HookExecutionContext = HookContext;

/**
 * Hook执行结果
 */
export type HookExecutionResult = HookResult;

/**
 * Hook事件元数据
 */
export interface HookEventMetadata {
  /**
   * 事件概要
   */
  summary?: string;

  /**
   * 事件描述
   */
  description?: string;

  /**
   * 匹配器元数据
   */
  matcherMetadata?: Record<string, unknown>;

  /**
   * 事件ID
   */
  eventId?: string;

  /**
   * 事件时间
   */
  timestamp?: number;

  /**
   * 事件来源
   */
  source?: string;

  /**
   * 额外数据
   */
  [key: string]: unknown;
}

/**
 * 匹配器元数据
 */
export interface MatcherMetadata {
  /**
   * 匹配器类型
   */
  type?: string;

  /**
   * 匹配模式
   */
  pattern?: string;

  /**
   * 匹配器配置
   */
  config?: Record<string, unknown>;

  /**
   * 额外属性
   */
  [key: string]: unknown;
}

/**
 * 脚本Hook配置
 * 用于在事件节点执行用户自定义脚本
 */
export interface ScriptHookConfig {
  /**
   * 脚本类型（默认 shell）
   */
  interpreter?: 'shell' | 'node' | 'python';

  /**
   * 内联脚本内容（与 scriptFile 二选一）
   */
  script?: string;

  /**
   * 脚本文件路径（与 script 二选一）
   */
  scriptFile?: string;

  /**
   * 超时时间（秒，默认 30）
   */
  timeout?: number;

  /**
   * 自定义环境变量
   */
  env?: Record<string, string>;

  /**
   * 启用沙箱模式（默认 true）
   * 沙箱模式下会拦截危险命令并移除敏感环境变量
   */
  sandbox?: boolean;

  /**
   * 是否允许脚本修改环境变量（默认 false）
   */
  allowEnvModification?: boolean;

  /**
   * 工作目录
   */
  cwd?: string;
}
