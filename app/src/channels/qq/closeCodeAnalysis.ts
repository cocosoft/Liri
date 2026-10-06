/**
 * closeCodeAnalysis.ts — QQ WebSocket 关闭码 → 重连策略
 *
 * 由 `QQChannel.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §40）：**只搬不改**（含全部原注释与
 * 日志文案）。logger 由调用方注入宿主同一实例 ⇒ 日志 module 字段与拆分前一致。
 */

import { Logger } from '@modules/monitoring';
import { QQCloseCode, RATE_LIMIT_DELAY } from './types';

/** 关闭码分析结果（重连策略） */
export interface QQCloseCodeAction {
  shouldReconnect: boolean;
  clearSession: boolean;
  refreshToken: boolean;
  delay?: number;
  fatal: boolean;
}

/**
 * 分析 WebSocket 关闭码并返回重连策略
 * 对标 OpenClaw ReconnectState.handleClose
 */
export function analyzeCloseCode(
  code: number,
  logger: Logger
): QQCloseCodeAction {
  switch (code) {
    case QQCloseCode.INSUFFICIENT_INTENTS:
    case QQCloseCode.DISALLOWED_INTENTS:
      logger.error(`QQ Bot 被平台封禁/下线 (${code})，停止重连`);
      return {
        shouldReconnect: false,
        clearSession: false,
        refreshToken: false,
        fatal: true,
      };

    case QQCloseCode.AUTH_FAILED:
      logger.info('QQ Bot Token 无效 (4004)，刷新 Token 后重连');
      return {
        shouldReconnect: true,
        clearSession: false,
        refreshToken: true,
        fatal: false,
      };

    case QQCloseCode.RATE_LIMITED:
      logger.info('QQ Bot 被限流 (4008)，等待 60s 后重连');
      return {
        shouldReconnect: true,
        clearSession: false,
        refreshToken: false,
        delay: RATE_LIMIT_DELAY,
        fatal: false,
      };

    case QQCloseCode.INVALID_SESSION:
    case QQCloseCode.SEQ_OUT_OF_RANGE:
    case QQCloseCode.SESSION_TIMEOUT:
      logger.info(`QQ Bot 会话异常 (${code})，清理后重连`);
      return {
        shouldReconnect: true,
        clearSession: true,
        refreshToken: true,
        fatal: false,
      };

    default:
      if (
        code >= QQCloseCode.SERVER_ERROR_START &&
        code <= QQCloseCode.SERVER_ERROR_END
      ) {
        logger.info(`QQ Bot 服务端内部错误 (${code})，清理后重连`);
        return {
          shouldReconnect: true,
          clearSession: true,
          refreshToken: true,
          fatal: false,
        };
      }
      // 1006 (异常关闭) / 1001 (离开) / 1005 (无状态码) 等：会话可能已失效，清理后重连
      if (code === 1006 || code === 1001 || code === 1005) {
        logger.info(`QQ Bot 连接异常关闭 (${code})，清理会话后重连`);
        return {
          shouldReconnect: true,
          clearSession: true,
          refreshToken: false,
          fatal: false,
        };
      }
      // 正常关闭或其他未知码
      return {
        shouldReconnect: code !== QQCloseCode.NORMAL,
        clearSession: false,
        refreshToken: false,
        fatal: false,
      };
  }
}
