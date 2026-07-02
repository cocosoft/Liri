/**
 * 前端轻量错误处理器
 *
 * 统一前端 catch 块的错误日志格式，提供模块级上下文。
 * 与后端 handleError 功能对应，但前端不做 OTel/ErrorTracker 追踪。
 */

import { createLogger } from './logger';

/** 错误处理上下文 */
export interface ClientErrorContext {
  /** 模块名（如 'stores:appStore'） */
  module: string;
  /** 操作名（如 'loadSessions'） */
  action: string;
  /** 额外元数据 */
  meta?: Record<string, unknown>;
}

/** 错误严重级别 */
export type ClientErrorSeverity = 'warn' | 'error';

/**
 * handleClientError — 前端统一错误处理
 *
 * 将 catch 到的错误统一记录日志，避免各模块散落 console.error。
 *
 * @param err 捕获的错误对象
 * @param ctx 上下文信息
 * @param severity 严重级别，默认 'error'
 * @returns 标准化的错误消息字符串
 *
 * @example
 * ```ts
 * catch (e) {
 *   handleClientError(e, { module: 'stores:appStore', action: 'loadSessions' });
 * }
 * ```
 */
export function handleClientError(
  err: unknown,
  ctx: ClientErrorContext,
  severity: ClientErrorSeverity = 'error',
): string {
  const logger = createLogger(ctx.module);
  const errorMsg =
    err instanceof Error ? err.message : String(err);

  const logData: Record<string, unknown> = {
    action: ctx.action,
    ...ctx.meta,
  };

  if (err instanceof Error) {
    logData.stack = err.stack?.split('\n').slice(0, 3).join('\n');
  }

  if (severity === 'warn') {
    logger.warn(`${ctx.action} 失败: ${errorMsg}`, logData);
  } else {
    logger.error(`${ctx.action} 失败: ${errorMsg}`, logData);
  }

  return errorMsg;
}
