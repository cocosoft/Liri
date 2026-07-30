/**
 * 查询来源枚举
 *
 * 用于区分错误处理时的前台/后台场景：
 * - 前台（用户等待）：需要积极重试，提供友好提示
 * - 后台（非用户等待）：保守重试，避免级联放大
 */
export enum QuerySource {
  /** 用户交互式请求（用户在前端等待结果） */
  USER_INTERACTIVE = 'user_interactive',
  /** 后台任务（非用户等待的异步任务） */
  BACKGROUND_TASK = 'background_task',
  /** 钩子执行（pre/post hook） */
  HOOK = 'hook',
  /** 定时任务（cron/scheduled） */
  SCHEDULED = 'scheduled',
}

/**
 * 前台重试来源集合
 *
 * 只有这些来源的错误才会被积极重试，
 * 后台任务不重试 529 等服务器过载错误，避免级联放大。
 */
export const FOREGROUND_RETRY_SOURCES = new Set<QuerySource>([
  QuerySource.USER_INTERACTIVE,
  QuerySource.HOOK,
]);

/**
 * 判断是否应该在前台重试
 *
 * @param source 查询来源
 * @returns 是否为前台来源
 */
export function isForegroundSource(source: QuerySource): boolean {
  return FOREGROUND_RETRY_SOURCES.has(source);
}

/**
 * 判断是否应该在错误时重试
 *
 * 核心逻辑：
 * - 后台任务不重试服务器过载错误（529），避免级联放大
 * - 前台任务总是重试可恢复错误
 *
 * @param error 错误对象
 * @param source 查询来源
 * @returns 是否应该重试
 */
export function shouldRetryOnError(error: Error, source: QuerySource): boolean {
  // 后台任务不重试服务器过载错误
  if (isServerOverloadError(error) && !isForegroundSource(source)) {
    return false;
  }
  return true;
}

/**
 * 判断是否为服务器过载错误（529）
 */
function isServerOverloadError(error: Error): boolean {
  return (
    'status' in error && (error as Error & { status: number }).status === 529
  );
}

/**
 * 获取查询来源的描述信息
 */
export function getQuerySourceDescription(source: QuerySource): string {
  switch (source) {
    case QuerySource.USER_INTERACTIVE:
      return '用户交互式请求';
    case QuerySource.BACKGROUND_TASK:
      return '后台任务';
    case QuerySource.HOOK:
      return '钩子执行';
    case QuerySource.SCHEDULED:
      return '定时任务';
    default:
      return '未知来源';
  }
}

/**
 * 错误处理上下文
 *
 * 用于 ErrorHandler.handleError() 方法，
 * 提供更丰富的错误处理决策信息。
 */
export interface ErrorHandlingContext {
  /** 查询来源 */
  source: QuerySource;
  /** 当前重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 是否为流式请求 */
  isStreaming: boolean;
  /** 自定义标签 */
  tags?: Record<string, string>;
}

/**
 * 创建默认错误处理上下文
 */
export function createDefaultErrorContext(
  source: QuerySource = QuerySource.USER_INTERACTIVE,
  maxRetries: number = 3
): ErrorHandlingContext {
  return {
    source,
    retryCount: 0,
    maxRetries,
    isStreaming: false,
  };
}
