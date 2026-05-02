/**
 * 错误系统类型定义
 */

/**
 * 错误类型
 */
export enum ErrorType {
  /**
   * 系统错误
   */
  SYSTEM = 'system',
  /**
   * 业务错误
   */
  BUSINESS = 'business',
  /**
   * 网络错误
   */
  NETWORK = 'network',
  /**
   * 认证错误
   */
  AUTHENTICATION = 'authentication',
  /**
   * 授权错误
   */
  AUTHORIZATION = 'authorization',
  /**
   * 输入错误
   */
  INPUT = 'input',
  /**
   * 资源错误
   */
  RESOURCE = 'resource',
  /**
   * 插件错误
   */
  PLUGIN = 'plugin',
  /**
   * 工具错误
   */
  TOOL = 'tool',
  /**
   * 其他错误
   */
  OTHER = 'other',
}

/**
 * 错误级别
 */
export enum ErrorLevel {
  /**
   * 调试
   */
  DEBUG = 'debug',
  /**
   * 信息
   */
  INFO = 'info',
  /**
   * 警告
   */
  WARNING = 'warning',
  /**
   * 错误
   */
  ERROR = 'error',
  /**
   * 致命
   */
  FATAL = 'fatal',
}

/**
 * 错误接口
 */
export interface AppError {
  /**
   * 错误ID
   */
  id: string;
  /**
   * 错误类型
   */
  type: ErrorType;
  /**
   * 错误级别
   */
  level: ErrorLevel;
  /**
   * 错误消息
   */
  message: string;
  /**
   * 错误代码
   */
  code?: string;
  /**
   * 错误详情
   */
  details?: any;
  /**
   * 原始错误
   */
  originalError?: Error;
  /**
   * 错误发生时间
   */
  timestamp: number;
  /**
   * 错误发生位置
   */
  location?: string;
  /**
   * 错误堆栈
   */
  stack?: string;
}

/**
 * 错误处理选项
 */
export interface ErrorHandlerOptions {
  /**
   * 是否记录错误
   */
  log?: boolean;
  /**
   * 是否返回详细错误信息
   */
  detailed?: boolean;
  /**
   * 错误处理回调
   */
  callback?: (error: AppError) => void;
}
