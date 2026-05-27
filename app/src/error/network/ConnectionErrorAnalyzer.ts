/**
 * 连接错误分析器
 *
 * 支持 15+ 种 SSL 错误码识别，遍历 cause 链提取根错误
 * 参考 CC_CODE cc_code/backend/services/api/errorUtils.ts
 */

/**
 * SSL/TLS 错误码集合（OpenSSL 标准错误码）
 * 来源: https://www.openssl.org/docs/man3.1/man3/X509_STORE_CTX_get_error.html
 */
export const SSL_ERROR_CODES = new Set([
  // 证书验证错误
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CERT_REVOKED',
  'CERT_REJECTED',
  'CERT_UNTRUSTED',
  // 自签名证书错误
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  // 证书链错误
  'CERT_CHAIN_TOO_LONG',
  'PATH_LENGTH_EXCEEDED',
  // 主机名/备用名错误
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  // TLS 握手错误
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
]);

/**
 * 连接错误类型
 */
export type ConnectionErrorType =
  | 'ssl'
  | 'timeout'
  | 'refused'
  | 'reset'
  | 'dns'
  | 'proxy'
  | 'unknown';

/**
 * 连接错误分析结果
 */
export interface ConnectionAnalysis {
  type: ConnectionErrorType;
  code?: string;
  message: string;
  hint?: string;
  isSSLError: boolean;
}

/**
 * 连接错误详情（内部使用）
 */
export interface ConnectionErrorDetails {
  code: string;
  message: string;
  isSSLError: boolean;
}

/**
 * 从错误 cause 链中提取连接错误详情
 *
 * Anthropic SDK 会将底层错误包装在 cause 属性中，
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
 * 获取 SSL 错误的操作提示
 *
 * 适用于企业 TLS 拦截代理（Zscaler 等）场景，
 * 帮助用户快速定位问题。
 */
export function getSSLErrorHint(error: unknown): string | null {
  const details = extractConnectionErrorDetails(error);
  if (!details?.isSSLError) {
    return null;
  }
  return `SSL certificate error (${details.code}). If you are behind a corporate proxy or TLS-intercepting firewall, set NODE_EXTRA_CA_CERTS to your CA bundle path, or ask IT to allowlist *.anthropic.com. Run /doctor for details.`;
}

/**
 * 获取 SSL 错误的用户友好提示
 */
export function getSSLUserMessage(code: string): string {
  switch (code) {
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
      return 'SSL 证书验证失败，请检查代理或企业 SSL 证书';
    case 'CERT_HAS_EXPIRED':
      return 'SSL 证书已过期';
    case 'CERT_REVOKED':
      return 'SSL 证书已被撤销';
    case 'CERT_NOT_YET_VALID':
      return 'SSL 证书尚未生效';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return '检测到自签名证书，请检查代理或企业 SSL 证书';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'HOSTNAME_MISMATCH':
      return 'SSL 证书主机名不匹配';
    case 'CERT_CHAIN_TOO_LONG':
      return 'SSL 证书链过长';
    case 'ERR_TLS_HANDSHAKE_TIMEOUT':
      return 'TLS 握手超时';
    default:
      return `SSL 错误 (${code})`;
  }
}

/**
 * 分析连接错误
 *
 * 遍历 cause 链，识别错误类型，返回用户友好的提示。
 */
export function analyzeConnectionError(error: Error): ConnectionAnalysis {
  const details = extractConnectionErrorDetails(error);

  if (details) {
    const { code, isSSLError } = details;

    if (isSSLError) {
      return {
        type: 'ssl',
        code,
        message: details.message,
        hint: getSSLUserMessage(code),
        isSSLError: true,
      };
    }

    switch (code) {
      case 'ETIMEDOUT':
        return {
          type: 'timeout',
          code,
          message: details.message,
          hint: '请求超时，请检查网络连接',
          isSSLError: false,
        };
      case 'ECONNREFUSED':
        return {
          type: 'refused',
          code,
          message: details.message,
          hint: '连接被拒绝，请检查服务器是否运行',
          isSSLError: false,
        };
      case 'ECONNRESET':
        return {
          type: 'reset',
          code,
          message: details.message,
          hint: '连接被重置，请检查网络稳定性',
          isSSLError: false,
        };
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return {
          type: 'dns',
          code,
          message: details.message,
          hint: 'DNS 解析失败，请检查网络或 DNS 设置',
          isSSLError: false,
        };
      case 'EPROXY':
      case 'PROXY_CONNECTION_FAILED':
        return {
          type: 'proxy',
          code,
          message: details.message,
          hint: '代理连接失败，请检查代理配置',
          isSSLError: false,
        };
      default:
        return {
          type: 'unknown',
          code,
          message: details.message,
          hint: `连接错误 (${code})`,
          isSSLError: false,
        };
    }
  }

  // 从消息中识别错误类型
  const message = error.message.toLowerCase();

  if (message.includes('timeout')) {
    return {
      type: 'timeout',
      message: error.message,
      hint: '请求超时，请检查网络连接',
      isSSLError: false,
    };
  }

  if (message.includes('connection refused')) {
    return {
      type: 'refused',
      message: error.message,
      hint: '连接被拒绝，请检查服务器是否运行',
      isSSLError: false,
    };
  }

  if (message.includes('connection reset')) {
    return {
      type: 'reset',
      message: error.message,
      hint: '连接被重置，请检查网络稳定性',
      isSSLError: false,
    };
  }

  if (message.includes('dns') || message.includes('not found')) {
    return {
      type: 'dns',
      message: error.message,
      hint: 'DNS 解析失败，请检查网络或 DNS 设置',
      isSSLError: false,
    };
  }

  return {
    type: 'unknown',
    message: error.message,
    isSSLError: false,
  };
}

/**
 * 格式化连接错误为用户友好消息
 */
export function formatConnectionError(error: Error): string {
  const analysis = analyzeConnectionError(error);

  if (analysis.hint) {
    return analysis.hint;
  }

  if (analysis.code) {
    return `连接错误 (${analysis.code})`;
  }

  return error.message;
}
