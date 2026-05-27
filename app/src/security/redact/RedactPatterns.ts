/**
 * 脱敏模式定义
 * 对标 Hermes agent/redact.py，定义 50+ 敏感字段模式和 16+ Body 键模式
 */

/**
 * 敏感查询参数键（50+ 字段）
 * 覆盖 API Key、Token、密码、凭证、密钥等常见敏感参数名
 */
export const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  // API 密钥类
  /(?:^|[_.-])api[_-]?key$/i,
  /(?:^|[_.-])apikey$/i,
  /(?:^|[_.-])api[_-]?secret$/i,
  /(?:^|[_.-])api[_-]?token$/i,
  /(?:^|[_.-])access[_-]?token$/i,
  /(?:^|[_.-])refresh[_-]?token$/i,
  /(?:^|[_.-])bearer[_-]?token$/i,
  /(?:^|[_.-])client[_-]?secret$/i,
  /(?:^|[_.-])client[_-]?id$/i,
  /(?:^|[_.-])oauth[_-]?token$/i,
  /(?:^|[_.-])auth[_-]?token$/i,

  // 密码类
  /(?:^|[_.-])password$/i,
  /(?:^|[_.-])passwd$/i,
  /(?:^|[_.-])pwd$/i,
  /(?:^|[_.-])secret$/i,
  /(?:^|[_.-])passcode$/i,
  /(?:^|[_.-])pin$/i,

  // Token 类
  /(?:^|[_.-])token$/i,
  /(?:^|[_.-])jwt$/i,
  /(?:^|[_.-])session[_-]?token$/i,
  /(?:^|[_.-])csrf[_-]?token$/i,
  /(?:^|[_.-])xsrf[_-]?token$/i,

  // 加密密钥类
  /(?:^|[_.-])private[_-]?key$/i,
  /(?:^|[_.-])public[_-]?key$/i,
  /(?:^|[_.-])encryption[_-]?key$/i,
  /(?:^|[_.-])signing[_-]?key$/i,
  /(?:^|[_.-])master[_-]?key$/i,
  /(?:^|[_.-])secret[_-]?key$/i,
  /(?:^|[_.-])ssh[_-]?key$/i,
  /(?:^|[_.-])pgp[_-]?key$/i,

  // 证书类
  /(?:^|[_.-])certificate$/i,
  /(?:^|[_.-])cert$/i,
  /(?:^|[_.-])ssl[_-]?cert$/i,
  /(?:^|[_.-])tls[_-]?cert$/i,

  // 凭证类
  /(?:^|[_.-])credential$/i,
  /(?:^|[_.-])credentials$/i,
  /(?:^|[_.-])auth[_-]?key$/i,
  /(?:^|[_.-])authorization$/i,
  /(?:^|[_.-])x[_-]?api[_-]?key$/i,
  /(?:^|[_.-])x[_-]?auth[_-]?token$/i,

  // 数据库连接字符串
  /(?:^|[_.-])connection[_-]?string$/i,
  /(?:^|[_.-])conn[_-]?str$/i,
  /(?:^|[_.-])db[_-]?url$/i,
  /(?:^|[_.-])database[_-]?url$/i,
  /(?:^|[_.-])mongodb[_-]?uri$/i,
  /(?:^|[_.-])redis[_-]?url$/i,

  // AWS / 云服务密钥
  /(?:^|[_.-])aws[_-]?access[_-]?key$/i,
  /(?:^|[_.-])aws[_-]?secret[_-]?key$/i,
  /(?:^|[_.-])aws[_-]?session[_-]?token$/i,
  /(?:^|[_.-])s3[_-]?access[_-]?key$/i,
  /(?:^|[_.-])gcp[_-]?service[_-]?account$/i,
  /(?:^|[_.-])azure[_-]?key$/i,

  // Webhook 与签名
  /(?:^|[_.-])webhook[_-]?secret$/i,
  /(?:^|[_.-])webhook[_-]?token$/i,
  /(?:^|[_.-])webhook[_-]?url$/i,
  /(?:^|[_.-])signing[_-]?secret$/i,
  /(?:^|[_.-])hmac[_-]?key$/i,
];

/**
 * 敏感 Body 键模式（16+ 字段）
 * 覆盖消息体中的敏感字段
 */
export const SENSITIVE_BODY_PATTERNS: RegExp[] = [
  // 消息内容中的凭证
  /(?:^|[_.-])messages\[\d+\]\.content$/i,

  // 请求体中的敏感字段
  /(?:^|[_.-])api_key$/i,
  /(?:^|[_.-])apikey$/i,
  /(?:^|[_.-])api_secret$/i,
  /(?:^|[_.-])access_token$/i,
  /(?:^|[_.-])refresh_token$/i,
  /(?:^|[_.-])bearer$/i,
  /(?:^|[_.-])auth_header$/i,
  /(?:^|[_.-])authorization$/i,
  /(?:^|[_.-])x-api-key$/i,
  /(?:^|[_.-])x-auth-token$/i,
  /(?:^|[_.-])token$/i,
  /(?:^|[_.-])password$/i,
  /(?:^|[_.-])secret$/i,
  /(?:^|[_.-])private_key$/i,
  /(?:^|[_.-])signature$/i,
  /(?:^|[_.-])encrypted_data$/i,
  /(?:^|[_.-])ciphertext$/i,
];

/**
 * 短 Token 最小长度阈值
 * 短于此长度的 token 将被完全遮盖
 */
export const SHORT_TOKEN_MIN_LENGTH = 18;

/**
 * 长 Token 保留策略：保留前 N 个字符和后 M 个字符
 */
export const LONG_TOKEN_PREFIX_CHARS = 6;
export const LONG_TOKEN_SUFFIX_CHARS = 4;

/**
 * 敏感数值模式
 * 匹配信用卡号、身份证号等
 */
export const NUMERIC_SENSITIVE_PATTERNS: RegExp[] = [
  /\b(?:\d[ -]*?){13,16}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g,
];

/**
 * 敏感邮箱模式
 */
export const EMAIL_PATTERN =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

/**
 * 遮盖字符串
 */
export const REDACTED_PLACEHOLDER = '***';

/**
 * 上下文遮盖提示
 */
export const REDACTED_CONTEXT_PLACEHOLDER = '[redacted]';
