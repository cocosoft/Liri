/**
 * 工具扩展选项
 */

export interface ExtendedToolOptions {
  /**
   * 执行超时（毫秒）
   */
  timeout?: number;

  /**
   * 内存限制（MB）
   */
  memoryLimit?: number;

  /**
   * 并行执行
   */
  parallel?: boolean;

  /**
   * 执行环境
   */
  environment?: Record<string, string>;

  /**
   * 输出格式
   */
  outputFormat?: 'text' | 'json' | 'html';

  /**
   * 缓存策略
   */
  cache?: {
    enabled: boolean;
    key?: string;
    ttl?: number;
  };

  /**
   * 重试策略
   */
  retry?: {
    enabled: boolean;
    maxAttempts: number;
    delay: number;
  };

  /**
   * 日志级别
   */
  logLevel?: 'error' | 'warn' | 'info' | 'debug';

  /**
   * 工作目录
   */
  cwd?: string;

  /**
   * 额外参数
   */
  extraArgs?: string[];
}

/**
 * 工具结果
 */
export interface ToolResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 结果数据
   */
  data?: any;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 执行时间（毫秒）
   */
  executionTime: number;

  /**
   * 输出
   */
  output?: string;

  /**
   * 退出码
   */
  exitCode?: number;

  /**
   * 缓存信息
   */
  cacheInfo?: {
    hit: boolean;
    key: string;
  };
}

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  /**
   * 会话ID
   */
  sessionId: string;

  /**
   * 工作目录
   */
  cwd: string;

  /**
   * 环境变量
   */
  env: Record<string, string>;

  /**
   * 工具配置
   */
  config: any;

  /**
   * 取消信号
   */
  signal?: AbortSignal;
}
