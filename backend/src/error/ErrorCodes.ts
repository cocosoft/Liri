/**
 * 标准错误码定义
 *
 * 基于 ErrorIds.ts 的 ID 分配规则，提供结构化错误码描述。
 * 每个错误码包含数字代码、用户端中文消息和日志端严重级别。
 *
 * ID 分配规则（与 ErrorIds.ts 保持一致）:
 * - 1-99:     网络错误
 * - 100-199:  文件系统错误
 * - 200-299:  API 错误
 * - 300-399:  认证/授权错误
 * - 400-499:  配置错误
 * - 500-599:  执行/工具错误
 * - 600-699:  验证错误
 * - 700-799:  数据库错误
 * - 800-899:  缓存错误
 * - 900-999:  安全错误
 * - 1000-1099: 通用错误
 * - 1100-1199: AI 错误
 */

export interface ErrorCodeDef {
  code: number;
  message: string;
  level: 'CRITICAL' | 'ERROR' | 'WARN' | 'INFO';
}

export const ErrorCodes = {
  // ─── 通用错误 (1000-1099) ─────────────────────
  UNKNOWN: { code: 1000, message: '未知错误', level: 'ERROR' as const },
  NOT_IMPLEMENTED: {
    code: 1001,
    message: '功能未实现',
    level: 'WARN' as const,
  },
  INVALID_INPUT: {
    code: 1002,
    message: '输入参数无效',
    level: 'WARN' as const,
  },
  TIMEOUT: { code: 1003, message: '操作超时', level: 'ERROR' as const },
  INTERNAL: { code: 1004, message: '内部错误', level: 'ERROR' as const },
  ENTITY_NOT_FOUND: {
    code: 1005,
    message: '实体未找到',
    level: 'WARN' as const,
  },
  INVALID_STATE: {
    code: 1006,
    message: '当前状态不允许此操作',
    level: 'ERROR' as const,
  },

  // ─── 网络错误 (1-99) ──────────────────────────
  NETWORK_TIMEOUT: {
    code: 1,
    message: '网络连接超时',
    level: 'ERROR' as const,
  },
  NETWORK_CONNECTION_REFUSED: {
    code: 2,
    message: '网络连接被拒绝',
    level: 'ERROR' as const,
  },
  NETWORK_CONNECTION_RESET: {
    code: 3,
    message: '网络连接被重置',
    level: 'ERROR' as const,
  },
  NETWORK_DNS_NOT_FOUND: {
    code: 4,
    message: 'DNS 解析失败',
    level: 'ERROR' as const,
  },
  NETWORK_UNREACHABLE: {
    code: 9,
    message: '目标不可达',
    level: 'ERROR' as const,
  },

  // ─── 文件系统错误 (100-199) ────────────────────
  FILE_NOT_FOUND: { code: 100, message: '文件未找到', level: 'WARN' as const },
  FILE_PERMISSION_DENIED: {
    code: 101,
    message: '文件权限不足',
    level: 'ERROR' as const,
  },
  FILE_READ_FAILED: {
    code: 108,
    message: '文件读取失败',
    level: 'ERROR' as const,
  },
  FILE_WRITE_FAILED: {
    code: 109,
    message: '文件写入失败',
    level: 'ERROR' as const,
  },
  FILE_INVALID_PATH: {
    code: 105,
    message: '文件路径无效',
    level: 'WARN' as const,
  },

  // ─── API 错误 (200-299) ────────────────────────
  API_RATE_LIMITED: {
    code: 200,
    message: 'API 请求频率超限',
    level: 'WARN' as const,
  },
  API_SERVER_OVERLOAD: {
    code: 201,
    message: 'API 服务器过载',
    level: 'WARN' as const,
  },
  API_MODEL_UNAVAILABLE: {
    code: 204,
    message: '模型不可用',
    level: 'WARN' as const,
  },
  API_INVALID_MODEL: {
    code: 206,
    message: '无效的模型',
    level: 'WARN' as const,
  },
  API_CONTEXT_OVERFLOW: {
    code: 213,
    message: '上下文溢出',
    level: 'WARN' as const,
  },

  // ─── 认证/授权错误 (300-399) ────────────────────
  AUTH_TOKEN_EXPIRED: {
    code: 300,
    message: '令牌已过期',
    level: 'WARN' as const,
  },
  AUTH_INVALID_API_KEY: {
    code: 302,
    message: 'API 密钥无效',
    level: 'ERROR' as const,
  },
  AUTH_INSUFFICIENT_PERMISSIONS: {
    code: 304,
    message: '权限不足',
    level: 'WARN' as const,
  },
  PERMISSION_DENIED: {
    code: 4000,
    message: '权限不足',
    level: 'WARN' as const,
  },

  // ─── 配置错误 (400-499 / 5000) ───────────────────
  CONFIG_INVALID: { code: 5000, message: '配置无效', level: 'ERROR' as const },
  CONFIG_NOT_FOUND: {
    code: 400,
    message: '配置未找到',
    level: 'WARN' as const,
  },

  // ─── 工具/执行错误 (500-599 / 2000) ─────────────
  TOOL_NOT_FOUND: { code: 2000, message: '工具未找到', level: 'WARN' as const },
  TOOL_EXEC_FAILED: {
    code: 2001,
    message: '工具执行失败',
    level: 'ERROR' as const,
  },
  TOOL_PERMISSION_DENIED: {
    code: 2002,
    message: '工具权限不足',
    level: 'WARN' as const,
  },
  EXECUTION_FAILED: { code: 500, message: '执行失败', level: 'ERROR' as const },

  // ─── 转换器错误 (2003-2006) ────────────────────
  MISSING_DEPENDENCY: {
    code: 2003,
    message: '缺少可选依赖',
    level: 'WARN' as const,
  },
  UNSUPPORTED_FORMAT: {
    code: 2004,
    message: '不支持的格式',
    level: 'WARN' as const,
  },
  CONVERSION_FAILED: {
    code: 2005,
    message: '转换失败',
    level: 'ERROR' as const,
  },

  // ─── AI 错误 (1100-1199) ──────────────────────
  AI_CLIENT_ERROR: {
    code: 1100,
    message: 'AI 客户端错误',
    level: 'ERROR' as const,
  },
  AI_RATE_LIMITED: {
    code: 1101,
    message: 'AI 请求频率限制',
    level: 'WARN' as const,
  },
  AI_MODEL_ERROR: {
    code: 1102,
    message: 'AI 模型响应错误',
    level: 'ERROR' as const,
  },

  // ─── 安全错误 (900-999) ────────────────────────
  SECURITY_INJECTION_DETECTED: {
    code: 900,
    message: '检测到注入攻击',
    level: 'CRITICAL' as const,
  },
  SECURITY_PATH_TRAVERSAL: {
    code: 901,
    message: '检测到路径遍历',
    level: 'CRITICAL' as const,
  },
  SECURITY_UNSAFE_COMMAND: {
    code: 902,
    message: '检测到危险命令',
    level: 'CRITICAL' as const,
  },
} as const;

export type ErrorCodeKey = keyof typeof ErrorCodes;
export type ErrorCodeValue = (typeof ErrorCodes)[ErrorCodeKey];
