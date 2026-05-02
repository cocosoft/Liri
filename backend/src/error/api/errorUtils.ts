/**
 * 错误工具函数
 *
 * 设计参考: cc_code/backend/services/api/errorUtils.ts
 *
 * 提供连接错误提取、SSL 错误识别等通用错误处理工具。
 */

// SSL/TLS 错误码（OpenSSL 标准错误码）
const SSL_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CERT_REVOKED',
  'CERT_REJECTED',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_CHAIN_TOO_LONG',
  'PATH_LENGTH_EXCEEDED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
]);

/**
 * 连接错误详情接口
 */
export interface ConnectionErrorDetails {
  code: string;
  message: string;
  isSSLError: boolean;
}

/**
 * 从错误 cause 链中提取连接错误详情
 *
 * Anthropic SDK 将底层错误包装在 cause 属性中。
 * 此函数遍历 cause 链找到根错误码/消息。
 */
export function extractConnectionErrorDetails(
  error: unknown
): ConnectionErrorDetails | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  let current: unknown = error;
  const maxDepth = 5;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (
      current instanceof Error &&
      'code' in current &&
      typeof (current as any).code === 'string'
    ) {
      const code = (current as any).code;
      const isSSLError = SSL_ERROR_CODES.has(code);
      return {
        code,
        message: current.message,
        isSSLError,
      };
    }

    if (
      current instanceof Error &&
      'cause' in current &&
      (current as any).cause !== current
    ) {
      current = (current as any).cause;
      depth++;
    } else {
      break;
    }
  }

  return null;
}

/**
 * 获取 SSL 错误的用户友好提示
 */
export function getSSLErrorHint(error: unknown): string | null {
  const details = extractConnectionErrorDetails(error);
  if (!details?.isSSLError) {
    return null;
  }
  return `SSL 证书错误 (${details.code})。如果您在企业代理或 TLS 拦截防火墙后面，请设置 NODE_EXTRA_CA_CERTS 指向您的 CA 包路径，或联系 IT 部门允许访问 *.anthropic.com。`;
}

/**
 * 判断是否为 SSL 错误
 */
export function isSSLError(error: unknown): boolean {
  const details = extractConnectionErrorDetails(error);
  return details?.isSSLError ?? false;
}

/**
 * 判断是否为连接错误
 */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const details = extractConnectionErrorDetails(error);
  if (details) {
    return true;
  }
  return (
    error.message.includes('Connection error') ||
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('ENOTFOUND')
  );
}

/**
 * 判断是否为超时错误
 */
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.toLowerCase().includes('timeout') ||
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('ECONNABORTED')
  );
}
