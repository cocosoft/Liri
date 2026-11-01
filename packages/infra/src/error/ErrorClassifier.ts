/**
 * API 错误分类器
 * 对标 Hermes error_classifier.py
 * 将底层 API 错误映射为结构化的 FailoverReason，支持故障转移决策
 */

/**
 * 故障转移原因枚举
 */
export enum FailoverReason {
  /** 速率限制 */
  RATE_LIMITED = 'rate_limited',
  /** 服务器过载 */
  SERVER_OVERLOAD = 'server_overload',
  /** 认证失败 */
  AUTH_FAILED = 'auth_failed',
  /** 模型不可用 */
  MODEL_UNAVAILABLE = 'model_unavailable',
  /** 上下文溢出 */
  CONTEXT_OVERFLOW = 'context_overflow',
  /** 输入过长 */
  INPUT_TOO_LONG = 'input_too_long',
  /** 网络超时 */
  NETWORK_TIMEOUT = 'network_timeout',
  /** 网络错误 */
  NETWORK_ERROR = 'network_error',
  /** 未知错误 */
  UNKNOWN = 'unknown',
}

/**
 * 错误分类结果
 */
export interface ErrorClassification {
  /** 故障转移原因 */
  failoverReason: FailoverReason;
  /** 是否可重试 */
  retryable: boolean;
  /** 是否应切换提供商 */
  shouldFailover: boolean;
  /** 推荐冷却时间（毫秒） */
  cooldownMs: number;
  /** 原始 HTTP 状态码 */
  httpStatus?: number;
  /** 错误消息摘要 */
  summary: string;
}

/**
 * HTTP 状态码 → 错误分类映射表
 */
const HTTP_STATUS_CLASSIFICATION: Record<number, ErrorClassification> = {
  401: {
    failoverReason: FailoverReason.AUTH_FAILED,
    retryable: false,
    shouldFailover: false,
    cooldownMs: 0,
    summary: '认证失败，API Key 无效或已过期',
  },
  403: {
    failoverReason: FailoverReason.AUTH_FAILED,
    retryable: false,
    shouldFailover: false,
    cooldownMs: 0,
    summary: '权限不足，请检查账户权限',
  },
  429: {
    failoverReason: FailoverReason.RATE_LIMITED,
    retryable: true,
    shouldFailover: true,
    cooldownMs: 30_000,
    summary: '请求频率超限，建议切换凭证或等待',
  },
  500: {
    failoverReason: FailoverReason.SERVER_OVERLOAD,
    retryable: true,
    shouldFailover: true,
    cooldownMs: 5_000,
    summary: '服务器内部错误',
  },
  502: {
    failoverReason: FailoverReason.SERVER_OVERLOAD,
    retryable: true,
    shouldFailover: true,
    cooldownMs: 5_000,
    summary: '服务器网关错误',
  },
  503: {
    failoverReason: FailoverReason.SERVER_OVERLOAD,
    retryable: true,
    shouldFailover: true,
    cooldownMs: 10_000,
    summary: '服务暂时不可用',
  },
  504: {
    failoverReason: FailoverReason.NETWORK_TIMEOUT,
    retryable: true,
    shouldFailover: false,
    cooldownMs: 5_000,
    summary: '网关超时',
  },
  529: {
    failoverReason: FailoverReason.SERVER_OVERLOAD,
    retryable: true,
    shouldFailover: true,
    cooldownMs: 60_000,
    summary: '服务器过载（529），建议切换提供商',
  },
};

/**
 * 错误消息关键词 → 分类映射
 */
const ERROR_MESSAGE_PATTERNS: Array<{
  pattern: RegExp;
  classification: Partial<ErrorClassification>;
}> = [
  {
    pattern: /rate[_\s]?limit|too many requests|quota exceeded/i,
    classification: {
      failoverReason: FailoverReason.RATE_LIMITED,
      retryable: true,
      shouldFailover: true,
      cooldownMs: 30_000,
    },
  },
  {
    pattern: /overloaded|over[_\s]?capacity|too busy/i,
    classification: {
      failoverReason: FailoverReason.SERVER_OVERLOAD,
      retryable: true,
      shouldFailover: true,
      cooldownMs: 10_000,
    },
  },
  {
    pattern: /invalid.*api[_\s]?key|unauthorized|auth.*failed|token.*expired/i,
    classification: {
      failoverReason: FailoverReason.AUTH_FAILED,
      retryable: false,
      shouldFailover: false,
      cooldownMs: 0,
    },
  },
  {
    pattern: /model.*not.*(found|available|supported)|does not exist/i,
    classification: {
      failoverReason: FailoverReason.MODEL_UNAVAILABLE,
      retryable: false,
      shouldFailover: true,
      cooldownMs: 0,
    },
  },
  {
    pattern:
      /context.*(length|overflow|exceeded)|prompt.*too.*long|token.*limit/i,
    classification: {
      failoverReason: FailoverReason.CONTEXT_OVERFLOW,
      retryable: false,
      shouldFailover: false,
      cooldownMs: 0,
    },
  },
  {
    pattern: /timeout|timed[_\s]?out|ECONNABORTED|ETIMEDOUT/i,
    classification: {
      failoverReason: FailoverReason.NETWORK_TIMEOUT,
      retryable: true,
      shouldFailover: false,
      cooldownMs: 3_000,
    },
  },
  {
    pattern: /network|ECONNREFUSED|ENOTFOUND|DNS|socket/i,
    classification: {
      failoverReason: FailoverReason.NETWORK_ERROR,
      retryable: true,
      shouldFailover: false,
      cooldownMs: 5_000,
    },
  },
];

/**
 * 错误分类器
 * 将底层 API 错误映射到结构化的 FailoverReason
 */
export class ErrorClassifier {
  /**
   * 分类 HTTP 错误
   * @param httpStatus HTTP 状态码
   * @param errorMessage 错误消息
   * @returns 错误分类结果
   */
  classify(httpStatus?: number, errorMessage?: string): ErrorClassification {
    if (httpStatus && HTTP_STATUS_CLASSIFICATION[httpStatus]) {
      return { ...HTTP_STATUS_CLASSIFICATION[httpStatus], httpStatus };
    }

    if (errorMessage) {
      const messageMatch = this.classifyByMessage(errorMessage);
      if (messageMatch) {
        return {
          ...messageMatch,
          httpStatus,
        };
      }
    }

    return {
      failoverReason: FailoverReason.UNKNOWN,
      retryable: true,
      shouldFailover: false,
      cooldownMs: 10_000,
      httpStatus,
      summary: errorMessage
        ? `未分类错误: ${errorMessage.slice(0, 200)}`
        : '未知错误',
    };
  }

  /**
   * 根据错误消息分类
   * @param message 错误消息
   * @returns 分类结果或 null
   */
  private classifyByMessage(message: string): ErrorClassification | null {
    for (const { pattern, classification } of ERROR_MESSAGE_PATTERNS) {
      if (pattern.test(message)) {
        return {
          failoverReason:
            classification.failoverReason || FailoverReason.UNKNOWN,
          retryable: classification.retryable ?? true,
          shouldFailover: classification.shouldFailover ?? false,
          cooldownMs: classification.cooldownMs || 10000,
          summary: message.slice(0, 200),
        };
      }
    }

    return null;
  }

  /**
   * 从 Error 对象分类
   * @param error Error 对象
   * @returns 错误分类结果
   */
  classifyFromError(error: Error): ErrorClassification {
    const errorObj = error as Error & {
      status?: number;
      statusCode?: number;
      code?: string;
    };
    const httpStatus = errorObj.status || errorObj.statusCode;

    return this.classify(httpStatus, error.message);
  }

  /**
   * 批量分类多个错误
   * @param errors 错误数组
   * @returns 分类结果数组
   */
  classifyBatch(
    errors: Array<{ status?: number; message: string }>
  ): ErrorClassification[] {
    return errors.map((e) => this.classify(e.status, e.message));
  }

  /**
   * 判断是否应该触发故障转移
   * @param classification 分类结果
   * @returns 是否应故障转移
   */
  shouldTriggerFailover(classification: ErrorClassification): boolean {
    return classification.shouldFailover && classification.retryable;
  }

  /**
   * 获取推荐的冷却时间
   * @param classification 分类结果
   * @returns 冷却时间（毫秒）
   */
  getCooldown(classification: ErrorClassification): number {
    if (classification.failoverReason === FailoverReason.RATE_LIMITED) {
      return 30_000;
    }

    if (classification.failoverReason === FailoverReason.SERVER_OVERLOAD) {
      return 15_000;
    }

    return classification.cooldownMs;
  }
}

/**
 * 全局错误分类器实例
 */
let globalClassifier: ErrorClassifier | null = null;

/**
 * 获取全局错误分类器
 */
export function getErrorClassifier(): ErrorClassifier {
  if (!globalClassifier) {
    globalClassifier = new ErrorClassifier();
  }

  return globalClassifier;
}

/**
 * 快捷分类函数
 * @param error Error 对象
 * @returns 分类结果
 */
export function classifyError(error: Error): ErrorClassification {
  return getErrorClassifier().classifyFromError(error);
}
