/**
 * API 场景化错误分类器
 *
 * 设计参考: cc_code/backend/services/api/errors.ts 中的 classifyAPIError 和 getAssistantMessageFromError
 *
 * 将 API 错误分类为具体场景，支持用户消息生成、重试决策和动作提示。
 */

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from './ApiError';
import { extractConnectionErrorDetails } from './errorUtils';

/**
 * API 错误场景枚举
 */
export enum APIScene {
  RATE_LIMIT = 'rate_limit',
  SERVER_OVERLOAD = 'server_overload',
  PROMPT_TOO_LONG = 'prompt_too_long',
  MEDIA_TOO_LARGE = 'media_too_large',
  PDF_TOO_LARGE = 'pdf_too_large',
  PDF_PASSWORD_PROTECTED = 'pdf_password_protected',
  PDF_INVALID = 'pdf_invalid',
  AUTH_FAILED = 'auth_failed',
  TOKEN_EXPIRED = 'token_expired',
  TOKEN_REVOKED = 'token_revoked',
  OAUTH_ORG_NOT_ALLOWED = 'oauth_org_not_allowed',
  CONNECTION_ERROR = 'connection_error',
  CONNECTION_TIMEOUT = 'connection_timeout',
  SSL_CERT_ERROR = 'ssl_cert_error',
  MODEL_UNAVAILABLE = 'model_unavailable',
  MODEL_NOT_FOUND = 'model_not_found',
  INVALID_MODEL = 'invalid_model',
  CREDIT_LOW = 'credit_low',
  ORG_DISABLED = 'org_disabled',
  TOOL_USE_MISMATCH = 'tool_use_mismatch',
  UNEXPECTED_TOOL_RESULT = 'unexpected_tool_result',
  DUPLICATE_TOOL_USE_ID = 'duplicate_tool_use_id',
  TOOL_USE_ERROR = 'tool_use_error',
  EXTRA_USAGE_REQUIRED = 'extra_usage_required',
  CONTEXT_OVERFLOW = 'context_overflow',
  FAST_MODE_NOT_ENABLED = 'fast_mode_not_enabled',
  REQUEST_TOO_LARGE = 'request_too_large',
  CAPACITY_OFF_SWITCH = 'capacity_off_switch',
  REPEATED_529 = 'repeated_529',
  BEDROCK_MODEL_ACCESS = 'bedrook_model_access',
  ABORTED = 'aborted',
  SERVER_ERROR = 'server_error',
  CLIENT_ERROR = 'client_error',
  UNKNOWN = 'unknown',
}

/**
 * API 场景分类结果
 */
export interface APISceneResult {
  scene: APIScene;
  userMessage: string;
  retryable: boolean;
  retryAfterMs?: number;
  actionHint?: string;
  errorCode?: number;
}

/**
 * 分类 API 错误为具体场景
 *
 * 参考 CC_CODE classifyAPIError 和 getAssistantMessageFromError 的完整分支逻辑。
 * 按优先级排序：特定场景 → 状态码 → 连接错误 → 未知
 */
export function classifyAPIScene(error: unknown): APISceneResult {
  // 中止请求
  if (error instanceof Error && error.message === 'Request was aborted.') {
    return {
      scene: APIScene.ABORTED,
      userMessage: '请求已中止',
      retryable: false,
    };
  }

  // 超时错误
  if (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof APIConnectionError &&
      error.message.toLowerCase().includes('timeout')) ||
    (error instanceof Error &&
      (error.message.toLowerCase().includes('timeout') ||
        (error as any).code === 'ETIMEDOUT'))
  ) {
    return {
      scene: APIScene.CONNECTION_TIMEOUT,
      userMessage: '请求超时，请检查网络连接',
      retryable: true,
      retryAfterMs: 1000,
      actionHint: '检查网络连接和代理设置',
    };
  }

  // 重复 529 错误
  if (
    error instanceof Error &&
    error.message.includes('Repeated 529 Overloaded errors')
  ) {
    return {
      scene: APIScene.REPEATED_529,
      userMessage: '服务器持续过载，请稍后重试',
      retryable: false,
      actionHint: '等待几分钟后重试',
    };
  }

  // 紧急容量关闭
  if (
    error instanceof Error &&
    error.message.includes('Opus is experiencing high load')
  ) {
    return {
      scene: APIScene.CAPACITY_OFF_SWITCH,
      userMessage: 'Opus 当前负载较高，请切换到 Sonnet',
      retryable: false,
      actionHint: '使用 /model 切换到 Sonnet',
    };
  }

  // API 错误分类（包括 SDK APIError 和带 status 的普通 Error）
  if (
    error instanceof APIError ||
    (error instanceof Error && 'status' in error)
  ) {
    return classifyAPIErrorByStatus(error as APIError);
  }

  // 连接错误
  if (error instanceof APIConnectionError) {
    return classifyConnectionError(error);
  }

  // 通用错误 - 尝试从消息中识别场景
  if (error instanceof Error) {
    return classifyErrorByMessage(error);
  }

  return {
    scene: APIScene.UNKNOWN,
    userMessage: '发生未知错误',
    retryable: false,
  };
}

/**
 * 根据 API 错误状态码分类
 */
function classifyAPIErrorByStatus(error: APIError): APISceneResult {
  // 429 - 速率限制
  if (error.status === 429) {
    const retryAfterMs = parseRetryAfterHeader(error);
    return {
      scene: APIScene.RATE_LIMIT,
      userMessage: formatRateLimitMessage(error),
      retryable: true,
      retryAfterMs,
      actionHint: retryAfterMs
        ? `等待 ${Math.ceil(retryAfterMs / 1000)} 秒后重试`
        : '等待后重试',
    };
  }

  // 529 - 服务器过载
  if (
    error.status === 529 ||
    error.message?.includes('"type":"overloaded_error"')
  ) {
    return {
      scene: APIScene.SERVER_OVERLOAD,
      userMessage: '服务器过载，请稍后重试',
      retryable: true,
      retryAfterMs: 5000,
      actionHint: '服务器容量不足，等待后重试',
    };
  }

  // 413 - 请求过大
  if (error.status === 413) {
    return {
      scene: APIScene.REQUEST_TOO_LARGE,
      userMessage: '请求过大，请减小文件或使用较小的输入',
      retryable: false,
      actionHint: '使用较小的文件或拆分请求',
    };
  }

  // 404 - 模型不存在
  if (error.status === 404) {
    return {
      scene: APIScene.MODEL_NOT_FOUND,
      userMessage: `模型不可用，请切换到其他模型`,
      retryable: false,
      actionHint: '使用 /model 切换到可用模型',
    };
  }

  // 401/403 - 认证错误
  if (error.status === 401 || error.status === 403) {
    return classifyAuthError(error);
  }

  // 400 - 请求错误（细分多种场景）
  if (error.status === 400) {
    return classifyBadRequestError(error);
  }

  // 5xx - 服务器错误
  if (error.status && error.status >= 500) {
    return {
      scene: APIScene.SERVER_ERROR,
      userMessage: `服务器错误 (${error.status})`,
      retryable: true,
      retryAfterMs: 3000,
    };
  }

  // 4xx - 客户端错误
  if (error.status && error.status >= 400) {
    return {
      scene: APIScene.CLIENT_ERROR,
      userMessage: `客户端错误 (${error.status}): ${error.message}`,
      retryable: false,
    };
  }

  return {
    scene: APIScene.UNKNOWN,
    userMessage: `API 错误: ${error.message}`,
    retryable: false,
    errorCode: error.status,
  };
}

/**
 * 分类认证错误
 */
function classifyAuthError(error: APIError): APISceneResult {
  // API Key 无效（优先检查）
  if (error.message.toLowerCase().includes('x-api-key')) {
    return {
      scene: APIScene.AUTH_FAILED,
      userMessage: 'API 密钥无效，请检查配置',
      retryable: false,
      actionHint: '检查 API 密钥配置或运行 /login',
    };
  }

  // Token 过期
  if (error.status === 401) {
    return {
      scene: APIScene.TOKEN_EXPIRED,
      userMessage: '认证令牌已过期，请重新登录',
      retryable: false,
      actionHint: '运行 /login 重新认证',
    };
  }

  // Token 被撤销
  if (
    error.status === 403 &&
    error.message.includes('OAuth token has been revoked')
  ) {
    return {
      scene: APIScene.TOKEN_REVOKED,
      userMessage: 'OAuth 令牌已被撤销，请重新登录',
      retryable: false,
      actionHint: '运行 /login 重新认证',
    };
  }

  // OAuth 组织不允许
  if (
    error.status === 403 &&
    error.message.includes(
      'OAuth authentication is currently not allowed for this organization'
    )
  ) {
    return {
      scene: APIScene.OAUTH_ORG_NOT_ALLOWED,
      userMessage: '您的组织无权访问，请重新登录或联系管理员',
      retryable: false,
      actionHint: '运行 /login 或联系管理员',
    };
  }

  // 通用认证错误
  return {
    scene: APIScene.AUTH_FAILED,
    userMessage: `认证失败: ${error.message}`,
    retryable: false,
    actionHint: '运行 /login 重新认证',
  };
}

/**
 * 分类 400 请求错误
 */
function classifyBadRequestError(error: APIError): APISceneResult {
  // Prompt 过长
  if (error.message.toLowerCase().includes('prompt is too long')) {
    return {
      scene: APIScene.PROMPT_TOO_LONG,
      userMessage: 'Prompt 过长，请减少输入或使用 /compact 清理上下文',
      retryable: false,
      actionHint: '减少输入内容或运行 /compact',
    };
  }

  // PDF 过大
  if (error.message.includes('PDF') && error.message.includes('maximum')) {
    return {
      scene: APIScene.PDF_TOO_LARGE,
      userMessage: 'PDF 文件过大，请尝试其他方式读取',
      retryable: false,
      actionHint: '使用 pdftotext 等工具提取文本',
    };
  }

  // PDF 密码保护
  if (error.message.includes('The PDF specified is password protected')) {
    return {
      scene: APIScene.PDF_PASSWORD_PROTECTED,
      userMessage: 'PDF 文件受密码保护，请先移除密码',
      retryable: false,
    };
  }

  // PDF 无效
  if (error.message.includes('The PDF specified was not valid')) {
    return {
      scene: APIScene.PDF_INVALID,
      userMessage: 'PDF 文件无效，请尝试转换格式',
      retryable: false,
      actionHint: '使用 pdftotext 等工具转换',
    };
  }

  // 图片过大
  if (
    error.message.includes('image exceeds') &&
    error.message.includes('maximum')
  ) {
    return {
      scene: APIScene.MEDIA_TOO_LARGE,
      userMessage: '图片过大，请调整大小',
      retryable: false,
      actionHint: '调整图片大小或使用较小的图片',
    };
  }

  // 多图片尺寸超限
  if (
    error.message.includes('image dimensions exceed') &&
    error.message.includes('many-image')
  ) {
    return {
      scene: APIScene.MEDIA_TOO_LARGE,
      userMessage: '图片尺寸超出多图片请求限制',
      retryable: false,
      actionHint: '运行 /compact 移除旧图片或使用较小图片',
    };
  }

  // tool_use/tool_result 不匹配
  if (
    error.message.includes(
      '`tool_use` ids were found without `tool_result` blocks immediately after'
    )
  ) {
    return {
      scene: APIScene.TOOL_USE_MISMATCH,
      userMessage: '工具调用与结果不匹配',
      retryable: false,
      actionHint: '运行 /rewind 恢复对话',
    };
  }

  // 意外的 tool_result
  if (
    error.message.includes('unexpected `tool_use_id` found in `tool_result`')
  ) {
    return {
      scene: APIScene.UNEXPECTED_TOOL_RESULT,
      userMessage: '意外的工具结果 ID',
      retryable: false,
    };
  }

  // tool_use ID 重复
  if (error.message.includes('`tool_use` ids must be unique')) {
    return {
      scene: APIScene.DUPLICATE_TOOL_USE_ID,
      userMessage: '工具调用 ID 重复',
      retryable: false,
      actionHint: '运行 /rewind 恢复对话',
    };
  }

  // 无效模型名
  if (error.message.toLowerCase().includes('invalid model name')) {
    return {
      scene: APIScene.INVALID_MODEL,
      userMessage: '模型名称无效',
      retryable: false,
      actionHint: '使用 /model 切换到有效模型',
    };
  }

  // 需要额外用量
  if (error.message.includes('Extra usage is required for long context')) {
    return {
      scene: APIScene.EXTRA_USAGE_REQUIRED,
      userMessage: '长上下文需要启用额外用量',
      retryable: false,
      actionHint: '运行 /extra-usage 启用，或 /model 切换到标准上下文',
    };
  }

  // 组织被禁用
  if (error.message.toLowerCase().includes('organization has been disabled')) {
    return {
      scene: APIScene.ORG_DISABLED,
      userMessage: '您的 API 密钥所属组织已被禁用',
      retryable: false,
      actionHint: '取消设置环境变量或使用订阅认证',
    };
  }

  // Fast mode 未启用
  if (
    error.message.includes('fast mode') &&
    error.message.includes('not enabled')
  ) {
    return {
      scene: APIScene.FAST_MODE_NOT_ENABLED,
      userMessage: '快速模式未启用',
      retryable: false,
    };
  }

  return {
    scene: APIScene.CLIENT_ERROR,
    userMessage: `请求错误 (400): ${error.message}`,
    retryable: false,
  };
}

/**
 * 分类连接错误
 */
function classifyConnectionError(error: APIConnectionError): APISceneResult {
  const details = extractConnectionErrorDetails(error);

  if (details?.isSSLError) {
    return {
      scene: APIScene.SSL_CERT_ERROR,
      userMessage: formatSSLErrorMessage(details.code),
      retryable: false,
      actionHint: '检查代理或企业 SSL 证书配置',
    };
  }

  if (details?.code === 'ECONNRESET') {
    return {
      scene: APIScene.CONNECTION_ERROR,
      userMessage: '连接被重置，请重试',
      retryable: true,
      retryAfterMs: 1000,
    };
  }

  if (details?.code === 'EPIPE') {
    return {
      scene: APIScene.CONNECTION_ERROR,
      userMessage: '连接断开，请重试',
      retryable: true,
      retryAfterMs: 1000,
    };
  }

  return {
    scene: APIScene.CONNECTION_ERROR,
    userMessage: `连接错误: ${error.message}`,
    retryable: true,
    retryAfterMs: 2000,
    actionHint: '检查网络连接',
  };
}

/**
 * 根据错误消息分类（非 APIError）
 */
function classifyErrorByMessage(error: Error): APISceneResult {
  // 信用余额不足
  if (error.message.includes('Your credit balance is too low')) {
    return {
      scene: APIScene.CREDIT_LOW,
      userMessage: '信用余额不足',
      retryable: false,
      actionHint: '充值或联系管理员',
    };
  }

  // Bedrock 模型访问
  if (
    process.env.CLAUDE_CODE_USE_BEDROCK &&
    error.message.toLowerCase().includes('model id')
  ) {
    return {
      scene: APIScene.BEDROCK_MODEL_ACCESS,
      userMessage: '无权访问指定模型',
      retryable: false,
      actionHint: '使用 /model 切换到其他模型',
    };
  }

  return {
    scene: APIScene.UNKNOWN,
    userMessage: `未知错误: ${error.message}`,
    retryable: false,
  };
}

/**
 * 格式化速率限制消息
 */
function formatRateLimitMessage(error: APIError): string {
  const retryAfterMs = parseRetryAfterHeader(error);
  if (retryAfterMs) {
    return `速率限制已达到，请在 ${Math.ceil(retryAfterMs / 1000)} 秒后重试`;
  }
  return '速率限制已达到，请稍后重试';
}

/**
 * 格式化 SSL 错误消息
 */
function formatSSLErrorMessage(code?: string): string {
  switch (code) {
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
      return 'SSL 证书验证失败，请检查代理或企业 SSL 证书';
    case 'CERT_HAS_EXPIRED':
      return 'SSL 证书已过期';
    case 'CERT_REVOKED':
      return 'SSL 证书已被撤销';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return '检测到自签名证书，请检查代理或企业 SSL 证书';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'HOSTNAME_MISMATCH':
      return 'SSL 证书主机名不匹配';
    case 'CERT_NOT_YET_VALID':
      return 'SSL 证书尚未生效';
    default:
      return `SSL 证书错误${code ? ` (${code})` : ''}`;
  }
}

/**
 * 解析 Retry-After 头
 */
function parseRetryAfterHeader(error: APIError): number | undefined {
  const header =
    (error.headers as Record<string, string>)?.['retry-after'] ??
    (error.headers as Record<string, string>)?.['Retry-After'];

  if (header) {
    const seconds = parseInt(header, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }
  return undefined;
}
