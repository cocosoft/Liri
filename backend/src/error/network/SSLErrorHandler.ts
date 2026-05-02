/**
 * SSL 错误处理器
 * 
 * 提供 SSL/TLS 错误的详细分析和用户友好的处理建议。
 * 与 ConnectionErrorAnalyzer 配合使用，专注于 SSL 特定场景。
 */

/**
 * SSL 错误类型枚举
 */
export enum SSLErrorType {
  /** 证书验证失败 */
  CERT_VERIFICATION_FAILED = 'cert_verification_failed',
  /** 证书过期 */
  CERT_EXPIRED = 'cert_expired',
  /** 自签名证书 */
  SELF_SIGNED_CERT = 'self_signed_cert',
  /** 证书链不完整 */
  INCOMPLETE_CERT_CHAIN = 'incomplete_cert_chain',
  /** 主机名不匹配 */
  HOSTNAME_MISMATCH = 'hostname_mismatch',
  /** TLS 握手失败 */
  TLS_HANDSHAKE_FAILED = 'tls_handshake_failed',
  /** 协议版本不匹配 */
  PROTOCOL_VERSION_MISMATCH = 'protocol_version_mismatch',
  /** 未知 SSL 错误 */
  UNKNOWN = 'unknown',
}

/**
 * SSL 错误分析结果
 */
export interface SSLAnalysisResult {
  /** SSL 错误类型 */
  type: SSLErrorType;
  /** 原始错误码 */
  code?: string;
  /** 错误消息 */
  message: string;
  /** 用户友好的提示 */
  userHint: string;
  /** 技术提示（用于日志） */
  techHint?: string;
  /** 是否可恢复 */
  recoverable: boolean;
  /** 建议的操作 */
  suggestedAction?: string;
}

/**
 * SSL 错误码到类型的映射
 */
const SSL_CODE_TO_TYPE: Record<string, SSLErrorType> = {
  // 证书验证错误
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: SSLErrorType.CERT_VERIFICATION_FAILED,
  UNABLE_TO_GET_ISSUER_CERT: SSLErrorType.CERT_VERIFICATION_FAILED,
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: SSLErrorType.CERT_VERIFICATION_FAILED,
  CERT_SIGNATURE_FAILURE: SSLErrorType.CERT_VERIFICATION_FAILED,
  CERT_REJECTED: SSLErrorType.CERT_VERIFICATION_FAILED,
  CERT_UNTRUSTED: SSLErrorType.CERT_VERIFICATION_FAILED,
  
  // 证书过期
  CERT_NOT_YET_VALID: SSLErrorType.CERT_EXPIRED,
  CERT_HAS_EXPIRED: SSLErrorType.CERT_EXPIRED,
  CERT_REVOKED: SSLErrorType.CERT_EXPIRED,
  
  // 自签名证书
  DEPTH_ZERO_SELF_SIGNED_CERT: SSLErrorType.SELF_SIGNED_CERT,
  SELF_SIGNED_CERT_IN_CHAIN: SSLErrorType.SELF_SIGNED_CERT,
  
  // 证书链错误
  CERT_CHAIN_TOO_LONG: SSLErrorType.INCOMPLETE_CERT_CHAIN,
  PATH_LENGTH_EXCEEDED: SSLErrorType.INCOMPLETE_CERT_CHAIN,
  
  // 主机名/备用名错误
  ERR_TLS_CERT_ALTNAME_INVALID: SSLErrorType.HOSTNAME_MISMATCH,
  HOSTNAME_MISMATCH: SSLErrorType.HOSTNAME_MISMATCH,
  
  // TLS 握手错误
  ERR_TLS_HANDSHAKE_TIMEOUT: SSLErrorType.TLS_HANDSHAKE_FAILED,
  ERR_SSL_WRONG_VERSION_NUMBER: SSLErrorType.PROTOCOL_VERSION_MISMATCH,
  ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC: SSLErrorType.TLS_HANDSHAKE_FAILED,
};

/**
 * SSL 错误用户提示映射
 */
const SSL_USER_HINTS: Record<SSLErrorType, string> = {
  [SSLErrorType.CERT_VERIFICATION_FAILED]:
    'SSL 证书验证失败，请检查代理或企业 SSL 证书配置',
  [SSLErrorType.CERT_EXPIRED]:
    'SSL 证书已过期，请联系网站管理员更新证书',
  [SSLErrorType.SELF_SIGNED_CERT]:
    '检测到自签名证书，请检查代理或企业 SSL 证书配置',
  [SSLErrorType.INCOMPLETE_CERT_CHAIN]:
    'SSL 证书链不完整，请检查证书配置',
  [SSLErrorType.HOSTNAME_MISMATCH]:
    'SSL 证书主机名不匹配，请检查访问的网址是否正确',
  [SSLErrorType.TLS_HANDSHAKE_FAILED]:
    'TLS 握手失败，请检查网络连接和 TLS 配置',
  [SSLErrorType.PROTOCOL_VERSION_MISMATCH]:
    'TLS 协议版本不匹配，请升级客户端或服务器',
  [SSLErrorType.UNKNOWN]:
    '发生未知 SSL 错误，请检查网络和安全配置',
};

/**
 * SSL 错误技术提示映射
 */
const SSL_TECH_HINTS: Record<SSLErrorType, string> = {
  [SSLErrorType.CERT_VERIFICATION_FAILED]:
    '证书验证失败，可能是由于缺少根证书或中间证书',
  [SSLErrorType.CERT_EXPIRED]:
    '证书已过期或被吊销，需要更新证书',
  [SSLErrorType.SELF_SIGNED_CERT]:
    '自签名证书不受信任，需要添加到信任列表',
  [SSLErrorType.INCOMPLETE_CERT_CHAIN]:
    '证书链过长或缺少中间证书',
  [SSLErrorType.HOSTNAME_MISMATCH]:
    '证书中的 SAN 或 CN 与访问的主机名不匹配',
  [SSLErrorType.TLS_HANDSHAKE_FAILED]:
    'TLS 握手过程中断，可能是网络问题或配置不兼容',
  [SSLErrorType.PROTOCOL_VERSION_MISMATCH]:
    '客户端和服务器支持的 TLS 版本不兼容',
  [SSLErrorType.UNKNOWN]:
    '未知 SSL 错误，需要进一步诊断',
};

/**
 * 分析 SSL 错误
 * 
 * @param error 错误对象
 * @returns SSL 错误分析结果
 */
export function analyzeSSLError(error: Error): SSLAnalysisResult {
  const code = extractSSLCode(error);
  
  if (!code) {
    return {
      type: SSLErrorType.UNKNOWN,
      message: error.message,
      userHint: SSL_USER_HINTS[SSLErrorType.UNKNOWN],
      techHint: SSL_TECH_HINTS[SSLErrorType.UNKNOWN],
      recoverable: false,
    };
  }

  const type = SSL_CODE_TO_TYPE[code] ?? SSLErrorType.UNKNOWN;
  
  return {
    type,
    code,
    message: error.message,
    userHint: SSL_USER_HINTS[type],
    techHint: SSL_TECH_HINTS[type],
    recoverable: isSSLRecoverable(type),
    suggestedAction: getSuggestedAction(type),
  };
}

/**
 * 判断错误是否为 SSL 错误
 * 
 * @param error 错误对象
 * @returns 是否为 SSL 错误
 */
export function isSSLError(error: Error): boolean {
  const code = extractSSLCode(error);
  return code !== undefined && code in SSL_CODE_TO_TYPE;
}

/**
 * 提取 SSL 错误码
 * 
 * 遍历 cause 链，查找 SSL 相关的错误码。
 */
function extractSSLCode(error: Error): string | undefined {
  let current: unknown = error;
  const maxDepth = 5;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (current instanceof Error && 'code' in current) {
      const code = (current as any).code;
      if (typeof code === 'string' && code in SSL_CODE_TO_TYPE) {
        return code;
      }
    }
    
    if (current instanceof Error && current.cause) {
      current = current.cause;
      depth++;
    } else {
      break;
    }
  }

  return undefined;
}

/**
 * 判断 SSL 错误是否可恢复
 */
function isSSLRecoverable(type: SSLErrorType): boolean {
  switch (type) {
    case SSLErrorType.TLS_HANDSHAKE_FAILED:
      return true;
    case SSLErrorType.PROTOCOL_VERSION_MISMATCH:
      return false;
    case SSLErrorType.CERT_EXPIRED:
      return false;
    case SSLErrorType.HOSTNAME_MISMATCH:
      return false;
    default:
      return true;
  }
}

/**
 * 获取建议的操作
 */
function getSuggestedAction(type: SSLErrorType): string | undefined {
  switch (type) {
    case SSLErrorType.CERT_VERIFICATION_FAILED:
      return '检查代理设置或联系 IT 部门获取根证书';
    case SSLErrorType.CERT_EXPIRED:
      return '联系网站管理员更新 SSL 证书';
    case SSLErrorType.SELF_SIGNED_CERT:
      return '将自签名证书添加到信任列表，或联系管理员获取正式证书';
    case SSLErrorType.INCOMPLETE_CERT_CHAIN:
      return '检查服务器证书配置，确保包含完整的证书链';
    case SSLErrorType.HOSTNAME_MISMATCH:
      return '确认访问的网址与证书中的主机名一致';
    case SSLErrorType.TLS_HANDSHAKE_FAILED:
      return '检查网络连接，稍后重试';
    case SSLErrorType.PROTOCOL_VERSION_MISMATCH:
      return '升级客户端或服务器以支持兼容的 TLS 版本';
    default:
      return undefined;
  }
}

/**
 * 格式化 SSL 错误为用户友好消息
 * 
 * @param error 错误对象
 * @returns 格式化的用户消息
 */
export function formatSSLError(error: Error): string {
  const analysis = analyzeSSLError(error);
  
  let message = `SSL 错误: ${analysis.userHint}`;
  
  if (analysis.suggestedAction) {
    message += `\n建议操作: ${analysis.suggestedAction}`;
  }
  
  return message;
}
