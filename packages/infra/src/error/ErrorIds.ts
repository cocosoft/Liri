/**
 * 错误 ID 用于生产环境溯源
 *
 * 设计参考: cc_code/backend/constants/errorIds.ts
 *
 * ID 分配规则:
 * - 1-99: 网络错误
 * - 100-199: 文件系统错误
 * - 200-299: API 错误
 * - 300-399: 认证/授权错误
 * - 400-499: 配置错误
 * - 500-599: 执行错误
 * - 600-699: 验证错误
 * - 700-799: 数据库错误
 * - 800-899: 缓存错误
 * - 900-999: 安全错误
 *
 * ADDING A NEW ERROR TYPE:
 * 1. 在对应区段添加 const
 * 2. 更新 Next ID 注释
 *
 * 这些错误以数字常量形式导出，支持死代码消除（外部构建仅保留使用的数字）。
 *
 * Next ID: 1001
 */

// 网络错误 (1-99)
export const E_NETWORK_TIMEOUT = 1;
export const E_NETWORK_CONNECTION_REFUSED = 2;
export const E_NETWORK_CONNECTION_RESET = 3;
export const E_NETWORK_DNS_NOT_FOUND = 4;
export const E_NETWORK_SSL_CERT_EXPIRED = 5;
export const E_NETWORK_SSL_CERT_INVALID = 6;
export const E_NETWORK_SSL_HANDSHAKE_FAILED = 7;
export const E_NETWORK_PROXY_ERROR = 8;
export const E_NETWORK_UNREACHABLE = 9;
export const E_NETWORK_ECONNRESET = 10;
export const E_NETWORK_EPIPE = 11;
export const E_NETWORK_ETIMEDOUT = 12;

// 文件系统错误 (100-199)
export const E_FILE_NOT_FOUND = 100;
export const E_FILE_PERMISSION_DENIED = 101;
export const E_FILE_ALREADY_EXISTS = 102;
export const E_FILE_DIRECTORY_NOT_EMPTY = 103;
export const E_FILE_PATH_TOO_LONG = 104;
export const E_FILE_INVALID_PATH = 105;
export const E_FILE_IS_DIRECTORY = 106;
export const E_FILE_NOT_A_DIRECTORY = 107;
export const E_FILE_READ_FAILED = 108;
export const E_FILE_WRITE_FAILED = 109;
export const E_FILE_DISK_FULL = 110;

// API 错误 (200-299)
export const E_API_RATE_LIMIT = 200;
export const E_API_SERVER_OVERLOAD = 201;
export const E_API_PROMPT_TOO_LONG = 202;
export const E_API_MEDIA_TOO_LARGE = 203;
export const E_API_MODEL_UNAVAILABLE = 204;
export const E_API_CREDIT_LOW = 205;
export const E_API_INVALID_MODEL = 206;
export const E_API_TOOL_USE_MISMATCH = 207;
export const E_API_PDF_TOO_LARGE = 208;
export const E_API_PDF_PASSWORD_PROTECTED = 209;
export const E_API_PDF_INVALID = 210;
export const E_API_REQUEST_TOO_LARGE = 211;
export const E_API_EXTRA_USAGE_REQUIRED = 212;
export const E_API_CONTEXT_OVERFLOW = 213;
export const E_API_FAST_MODE_NOT_ENABLED = 214;
export const E_API_FAST_MODE_COOLDOWN = 215;

// 认证/授权错误 (300-399)
export const E_AUTH_TOKEN_EXPIRED = 300;
export const E_AUTH_TOKEN_REVOKED = 301;
export const E_AUTH_INVALID_API_KEY = 302;
export const E_AUTH_OAUTH_ORG_NOT_ALLOWED = 303;
export const E_AUTH_INSUFFICIENT_PERMISSIONS = 304;
export const E_AUTH_ORG_DISABLED = 305;
export const E_AUTH_CCR_AUTH_ERROR = 306;
export const E_AUTH_BEDROCK_CREDENTIALS = 307;
export const E_AUTH_VERTEX_CREDENTIALS = 308;

// 配置错误 (400-499)
export const E_CONFIG_PARSE_FAILED = 400;
export const E_CONFIG_INVALID_VALUE = 401;
export const E_CONFIG_MISSING_REQUIRED = 402;
export const E_CONFIG_INVALID_JSON = 403;
export const E_CONFIG_SCHEMA_MISMATCH = 404;

// 执行错误 (500-599)
export const E_EXECUTION_TIMEOUT = 500;
export const E_EXECUTION_SHELL_FAILED = 501;
export const E_EXECUTION_INTERRUPTED = 502;
export const E_EXECUTION_TOOL_FAILED = 503;
export const E_EXECUTION_PLUGIN_FAILED = 504;
export const E_EXECUTION_SUBAGENT_FAILED = 505;
export const E_EXECUTION_CONTEXT_OVERFLOW = 506;
export const E_EXECUTION_COMPRESSION_FAILED = 507;

// 验证错误 (600-699)
export const E_VALIDATION_INPUT_INVALID = 600;
export const E_VALIDATION_SCHEMA_MISMATCH = 601;
export const E_VALIDATION_REQUIRED_FIELD = 602;
export const E_VALIDATION_TYPE_MISMATCH = 603;
export const E_VALIDATION_RANGE_EXCEEDED = 604;
export const E_VALIDATION_PATTERN_MISMATCH = 605;
export const E_VALIDATION_MALFORMED_COMMAND = 606;

// 数据库错误 (700-799)
export const E_DB_CONNECTION_FAILED = 700;
export const E_DB_QUERY_FAILED = 701;
export const E_DB_CONSTRAINT_VIOLATION = 702;
export const E_DB_MIGRATION_FAILED = 703;
export const E_DB_LOCK_TIMEOUT = 704;

// 缓存错误 (800-899)
export const E_CACHE_MISS = 800;
export const E_CACHE_EXPIRED = 801;
export const E_CACHE_CORRUPTED = 802;
export const E_CACHE_WRITE_FAILED = 803;
export const E_CACHE_INVALIDATION_FAILED = 804;

// 安全错误 (900-999)
export const E_SECURITY_PATH_TRAVERSAL = 900;
export const E_SECURITY_INJECTION_DETECTED = 901;
export const E_SECURITY_RATE_LIMIT_BYPASS = 902;
export const E_SECURITY_UNSAFE_COMMAND = 903;
export const E_SECURITY_UNICODE_INJECTION = 904;
export const E_SECURITY_IFS_INJECTION = 905;
export const E_SECURITY_ENV_POLLUTION = 906;

// 错误 ID 到区段的映射（用于验证）
export const ERROR_ID_RANGES: Record<string, [number, number]> = {
  network: [1, 99],
  filesystem: [100, 199],
  api: [200, 299],
  auth: [300, 399],
  config: [400, 499],
  execution: [500, 599],
  validation: [600, 699],
  database: [700, 799],
  cache: [800, 899],
  security: [900, 999],
};

/**
 * 根据错误 ID 获取错误区段
 */
export function getErrorIdRange(errorId: number): string | null {
  for (const [range, [min, max]] of Object.entries(ERROR_ID_RANGES)) {
    if (errorId >= min && errorId <= max) {
      return range;
    }
  }
  return null;
}

/**
 * 验证错误 ID 是否在有效范围内
 */
export function isValidErrorId(errorId: number): boolean {
  return getErrorIdRange(errorId) !== null;
}
