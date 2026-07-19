/**
 * TTS 错误码、错误类和消息映射
 *
 * 集中管理所有 TTS 相关错误，提供：
 * - 错误码枚举（TTS_ERR_CODE）
 * - 结构化错误类（TTSApiError，继承自 AppError）
 * - 用户消息映射（含操作引导）
 * - TTSApiError 轻量化（code + provider + userMessage + actionHint + cause）
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services\voice\services\errors',
  level: LogLevel.INFO,
});

/** TTS 错误码枚举 */
export enum TTS_ERR_CODE {
  NETWORK_TIMEOUT = 'TTS_NETWORK_TIMEOUT',
  AUTH_FAILED = 'TTS_AUTH_FAILED',
  PROVIDER_UNAVAILABLE = 'TTS_PROVIDER_UNAVAILABLE',
  MODEL_NOT_FOUND = 'TTS_MODEL_NOT_FOUND',
  TEXT_TOO_LONG = 'TTS_TEXT_TOO_LONG',
  QUEUE_FAILURE = 'TTS_QUEUE_FAILURE',
  CIRCUIT_OPEN = 'TTS_CIRCUIT_OPEN',
  CACHE_UNAVAILABLE = 'TTS_CACHE_UNAVAILABLE',
  UNKNOWN = 'TTS_UNKNOWN',
}

/** TTS 错误码 → (ErrorCategory, ErrorSeverity) 映射 */
const TTS_ERROR_SEVERITY_MAP: Record<
  TTS_ERR_CODE,
  { category: ErrorCategory; severity: ErrorSeverity }
> = {
  [TTS_ERR_CODE.NETWORK_TIMEOUT]: {
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
  },
  [TTS_ERR_CODE.AUTH_FAILED]: {
    category: ErrorCategory.PERMISSION,
    severity: ErrorSeverity.HIGH,
  },
  [TTS_ERR_CODE.PROVIDER_UNAVAILABLE]: {
    category: ErrorCategory.API,
    severity: ErrorSeverity.HIGH,
  },
  [TTS_ERR_CODE.MODEL_NOT_FOUND]: {
    category: ErrorCategory.RESOURCE,
    severity: ErrorSeverity.HIGH,
  },
  [TTS_ERR_CODE.TEXT_TOO_LONG]: {
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.LOW,
  },
  [TTS_ERR_CODE.QUEUE_FAILURE]: {
    category: ErrorCategory.OPERATION,
    severity: ErrorSeverity.MEDIUM,
  },
  [TTS_ERR_CODE.CIRCUIT_OPEN]: {
    category: ErrorCategory.API,
    severity: ErrorSeverity.HIGH,
  },
  [TTS_ERR_CODE.CACHE_UNAVAILABLE]: {
    category: ErrorCategory.RESOURCE,
    severity: ErrorSeverity.MEDIUM,
  },
  [TTS_ERR_CODE.UNKNOWN]: {
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
  },
};

/** 已本地化的用户可见错误消息 */
export interface TTSUserMessage {
  /** 用户可见错误描述（已本地化） */
  message: string;
  /** 操作引导（前端可展示为按钮或提示） */
  actionHint?: string;
}

/** TTS 错误码 → 用户消息映射 */
const TTS_ERROR_MAP: Record<TTS_ERR_CODE, TTSUserMessage> = {
  [TTS_ERR_CODE.NETWORK_TIMEOUT]: {
    message: '语音合成服务响应超时，请检查网络连接后重试',
    actionHint: '检查网络连接',
  },
  [TTS_ERR_CODE.AUTH_FAILED]: {
    message: '语音合成服务认证失败，请检查 API Key 配置',
    actionHint: '前往设置页面检查 API Key',
  },
  [TTS_ERR_CODE.PROVIDER_UNAVAILABLE]: {
    message: '语音合成服务暂时不可用，已切换至备用服务',
    actionHint: '可尝试手动切换语音引擎',
  },
  [TTS_ERR_CODE.MODEL_NOT_FOUND]: {
    message: '语音模型文件不存在，请检查模型配置',
    actionHint: '重新下载或选择其他语音模型',
  },
  [TTS_ERR_CODE.TEXT_TOO_LONG]: {
    message: '文本过长，超过语音合成服务限制',
    actionHint: '请缩短文本内容后重试',
  },
  [TTS_ERR_CODE.QUEUE_FAILURE]: {
    message: '语音合成队列处理异常',
    actionHint: '请稍后重试',
  },
  [TTS_ERR_CODE.CIRCUIT_OPEN]: {
    message: '语音合成服务当前不可用（熔断保护）',
    actionHint: '请 30 秒后重试，或切换其他语音引擎',
  },
  [TTS_ERR_CODE.CACHE_UNAVAILABLE]: {
    message: '语音缓存读取失败',
    actionHint: '请稍后重试',
  },
  [TTS_ERR_CODE.UNKNOWN]: {
    message: '语音合成发生未知错误',
    actionHint: '请稍后重试或查看日志',
  },
};

/**
 * TTSApiError — 结构化 TTS 错误类
 *
 * 包含错误码、Provider 名称、用户可见消息和操作引导。
 * 所有 TTS 模块的 handleError 调用均应使用此错误类。
 *
 * @example
 *   throw new TTSApiError(
 *     TTS_ERR_CODE.AUTH_FAILED, 'edge-tts',
 *     '请检查 API Key 配置', '前往设置页面',
 *     originalError
 *   );
 */
export class TTSApiError extends AppError {
  /**
   * @param code    错误码枚举
   * @param provider  Provider 名称
   * @param userMessage 用户可见消息
   * @param actionHint  操作引导（可选）
   * @param cause   原始错误（可选）
   */
  constructor(
    public override readonly code: TTS_ERR_CODE,
    public readonly provider: string,
    public readonly userMessage: string,
    public readonly actionHint?: string,
    public override readonly cause?: Error
  ) {
    const sev = TTS_ERROR_SEVERITY_MAP[code] ?? {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
    };
    super(`[${code}] ${userMessage}`, sev.category, sev.severity, code);
    this.name = 'TTSApiError';
  }

  /** 从错误码获取预设用户消息并构造错误 */
  static fromTTSCode(
    code: TTS_ERR_CODE,
    provider: string,
    cause?: Error
  ): TTSApiError {
    const entry = TTS_ERROR_MAP[code];
    return new TTSApiError(
      code,
      provider,
      entry.message,
      entry.actionHint,
      cause
    );
  }

  /** 获取用户可见消息（前端展示用） */
  toUserMessage(): TTSUserMessage {
    return {
      message: this.userMessage,
      actionHint: this.actionHint,
    };
  }
}
