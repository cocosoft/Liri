/**
 * 系统常量定义
 * 包含配置常量、错误常量、状态常量等
 */

/**
 * 系统常量命名空间
 */
export namespace SystemConstants {
  /**
   * 应用名称
   */
  export const APP_NAME = 'PY_APP';

  /**
   * 应用版本
   */
  export const APP_VERSION = '1.0.0';

  /**
   * 默认会话超时时间（毫秒）
   */
  export const DEFAULT_SESSION_TIMEOUT = 30 * 60 * 1000;

  /**
   * 最大并发任务数
   */
  export const MAX_CONCURRENT_TASKS = 10;

  /**
   * 最大重试次数
   */
  export const MAX_RETRY_COUNT = 3;

  /**
   * 默认重试延迟（毫秒）
   */
  export const DEFAULT_RETRY_DELAY = 1000;

  /**
   * 心跳间隔（毫秒）
   */
  export const HEARTBEAT_INTERVAL = 30 * 1000;

  /**
   * 连接超时（毫秒）
   */
  export const CONNECTION_TIMEOUT = 10 * 1000;

  /**
   * 请求超时（毫秒）
   */
  export const REQUEST_TIMEOUT = 60 * 1000;

  /**
   * 最大日志文件大小（字节）
   */
  export const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;

  /**
   * 最大缓存大小（字节）
   */
  export const MAX_CACHE_SIZE = 100 * 1024 * 1024;

  /**
   * 缓存过期时间（毫秒）
   */
  export const CACHE_EXPIRY = 24 * 60 * 60 * 1000;
}

/**
 * 错误常量命名空间
 */
export namespace ErrorConstants {
  /**
   * 错误代码
   */
  export enum ErrorCode {
    UNKNOWN = 'UNKNOWN',
    INVALID_INPUT = 'INVALID_INPUT',
    NOT_FOUND = 'NOT_FOUND',
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    UNAUTHORIZED = 'UNAUTHORIZED',
    TIMEOUT = 'TIMEOUT',
    NETWORK_ERROR = 'NETWORK_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
    CONFIG_ERROR = 'CONFIG_ERROR',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    TASK_FAILED = 'TASK_FAILED',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
  }

  /**
   * 错误消息
   */
  export const ERROR_MESSAGES: Record<ErrorCode, string> = {
    [ErrorCode.UNKNOWN]: '发生未知错误',
    [ErrorCode.INVALID_INPUT]: '输入参数无效',
    [ErrorCode.NOT_FOUND]: '资源未找到',
    [ErrorCode.PERMISSION_DENIED]: '权限不足',
    [ErrorCode.UNAUTHORIZED]: '未授权访问',
    [ErrorCode.TIMEOUT]: '操作超时',
    [ErrorCode.NETWORK_ERROR]: '网络错误',
    [ErrorCode.DATABASE_ERROR]: '数据库错误',
    [ErrorCode.FILE_SYSTEM_ERROR]: '文件系统错误',
    [ErrorCode.CONFIG_ERROR]: '配置错误',
    [ErrorCode.VALIDATION_ERROR]: '验证失败',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: '请求频率超限',
    [ErrorCode.SESSION_EXPIRED]: '会话已过期',
    [ErrorCode.TASK_FAILED]: '任务执行失败',
    [ErrorCode.INTERNAL_ERROR]: '内部错误',
  };

  /**
   * 获取错误消息
   */
  export function getErrorMessage(code: ErrorCode): string {
    return ERROR_MESSAGES[code] || ERROR_MESSAGES[ErrorCode.UNKNOWN];
  }
}

/**
 * 状态常量命名空间
 */
export namespace StatusConstants {
  /**
   * 会话状态
   */
  export enum SessionStatus {
    ACTIVE = 'active',
    IDLE = 'idle',
    DISCONNECTED = 'disconnected',
    EXPIRED = 'expired',
  }

  /**
   * 任务状态
   */
  export enum TaskStatus {
    PENDING = 'pending',
    RUNNING = 'running',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
    TIMEOUT = 'timeout',
  }

  /**
   * 连接状态
   */
  export enum ConnectionStatus {
    CONNECTED = 'connected',
    CONNECTING = 'connecting',
    DISCONNECTED = 'disconnected',
    RECONNECTING = 'reconnecting',
    ERROR = 'error',
  }

  /**
   * 同步状态
   */
  export enum SyncStatus {
    IDLE = 'idle',
    SYNCING = 'syncing',
    ERROR = 'error',
    COMPLETED = 'completed',
  }

  /**
   * 权限模式
   */
  export enum PermissionMode {
    DEFAULT = 'default',
    BYPASS = 'bypass',
    AUTO = 'auto',
  }
}

/**
 * 配置常量命名空间
 */
export namespace ConfigConstants {
  /**
   * 默认配置文件名
   */
  export const DEFAULT_CONFIG_FILE = 'config.json';

  /**
   * 配置文件路径
   */
  export const CONFIG_FILE_PATHS = [
    './config.json',
    '~/.py_app/config.json',
    '/etc/py_app/config.json',
  ];

  /**
   * 默认端口
   */
  export const DEFAULT_PORT = 3000;

  /**
   * 默认主机
   */
  export const DEFAULT_HOST = 'localhost';

  /**
   * 环境变量前缀
   */
  export const ENV_PREFIX = 'PY_APP_';

  /**
   * 日志级别
   */
  export enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
  }

  /**
   * 日志级别值
   */
  export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
  };
}

/**
 * 网络常量命名空间
 */
export namespace NetworkConstants {
  /**
   * HTTP方法
   */
  export enum HttpMethod {
    GET = 'GET',
    POST = 'POST',
    PUT = 'PUT',
    DELETE = 'DELETE',
    PATCH = 'PATCH',
    HEAD = 'HEAD',
    OPTIONS = 'OPTIONS',
  }

  /**
   * HTTP状态码
   */
  export enum HttpStatus {
    OK = 200,
    CREATED = 201,
    NO_CONTENT = 204,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    TIMEOUT = 408,
    INTERNAL_SERVER_ERROR = 500,
    BAD_GATEWAY = 502,
    SERVICE_UNAVAILABLE = 503,
    GATEWAY_TIMEOUT = 504,
  }

  /**
   * 内容类型
   */
  export enum ContentType {
    JSON = 'application/json',
    XML = 'application/xml',
    TEXT = 'text/plain',
    HTML = 'text/html',
    FORM = 'application/x-www-form-urlencoded',
    MULTIPART = 'multipart/form-data',
  }

  /**
   * 默认User-Agent
   */
  export const DEFAULT_USER_AGENT = 'PY_APP/1.0.0';

  /**
   * 最大重定向次数
   */
  export const MAX_REDIRECTS = 5;
}

/**
 * 文件常量命名空间
 */
export namespace FileConstants {
  /**
   * 默认编码
   */
  export const DEFAULT_ENCODING = 'utf-8';

  /**
   * 临时目录
   */
  export const TEMP_DIR = '/tmp/py_app';

  /**
   * 缓存目录
   */
  export const CACHE_DIR = './.py_app/cache';

  /**
   * 日志目录
   */
  export const LOG_DIR = './.py_app/logs';

  /**
   * 数据目录
   */
  export const DATA_DIR = './.py_app/data';

  /**
   * 忽略的文件模式
   */
  export const IGNORED_PATTERNS = [
    'node_modules/**',
    '.git/**',
    '*.log',
    '.DS_Store',
    'Thumbs.db',
    '*.tmp',
    '*.temp',
  ];

  /**
   * 常见的二进制文件扩展名
   */
  export const BINARY_EXTENSIONS = [
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.bin',
    '.img',
    '.iso',
    '.zip',
    '.tar',
    '.gz',
    '.rar',
    '.7z',
  ];
}

/**
 * 时间常量命名空间
 */
export namespace TimeConstants {
  /**
   * 秒
   */
  export const SECOND = 1000;

  /**
   * 分钟
   */
  export const MINUTE = 60 * SECOND;

  /**
   * 小时
   */
  export const HOUR = 60 * MINUTE;

  /**
   * 天
   */
  export const DAY = 24 * HOUR;

  /**
   * 周
   */
  export const WEEK = 7 * DAY;

  /**
   * 月（30天）
   */
  export const MONTH = 30 * DAY;

  /**
   * 年（365天）
   */
  export const YEAR = 365 * DAY;
}

/**
 * 向后兼容：重新导出新常量体系
 * @deprecated 请使用 @/constants 替代
 */
export {
  APP_NAME,
  APP_VERSION,
  DEFAULT_SESSION_TIMEOUT,
  MAX_CONCURRENT_TASKS,
  DEFAULT_ENCODING,
} from '../constants/index.js';

export {
  APP_NAME as SYSTEM_APP_NAME,
  APP_VERSION as SYSTEM_APP_VERSION,
} from '../constants/common.js';
