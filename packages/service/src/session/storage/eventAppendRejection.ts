// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * append 拒绝告警（P1-2 审计 F1，2026-11-15）
 *
 * 背景：`EventLogStorage.append()` 对 `invalid-event`（载荷不可无损序列化 / 运行时未登记的事件
 * 类型）此前**只有一行 `logger.warn`** —— 不进 ErrorTracker、无计数、无事件；而
 * `appendStreamEvent` 的 33 处调用点里只有 6 处看返回值 ⇒ 模型可见输入（`user/message`、
 * `assistant/*`、`tool/result`…）静默从 `events.jsonl` 消失，唯一痕迹是一行日志。
 *
 * 与 `write-error` 的区别：这属**代码缺陷**（不是 IO 抖动）⇒ 错误码分开，便于按缺陷类型分流。
 * 无节流：该类事件应恒为 0，若真在循环里出现，其告警噪声本身即缺陷信号（CS03：不为不存在的
 * 场景加防抖状态）。
 *
 * 抽为独立模块的原因：`EventLogStorage.ts` 已达 R04-001 的 2000 行上限，告警逻辑外置可避免
 * 以"加几行告警"为由撑破文件体量上限。
 */
import {
  handleError,
  AppError,
  ErrorCategory,
  ErrorSeverity,
} from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring/logs/Logger';
import type { LiriEvent } from '@modules/session/types/events';

const logger = getLogger('session:event-log');

/** 拒绝写入的错误码（与 IO 类 `EVENT_APPEND_FAILED` 分开） */
export type AppendRejectCode =
  | 'EVENT_APPEND_INVALID_PAYLOAD'
  | 'EVENT_APPEND_UNKNOWN_TYPE';

/**
 * 上报一次「事件被拒绝写入」。
 *
 * 同时：① 打日志（运维可搜）；② 构造 HIGH 级 `AppError` 走 `handleError`
 * （Logger + ErrorTracker + OTel Span + `error:occurred` 事件 ⇒ AlertBridge 可消费）。
 */
export function reportInvalidAppend(
  sessionId: string,
  event: LiriEvent,
  reason: string,
  errorCode: AppendRejectCode
): void {
  const message =
    errorCode === 'EVENT_APPEND_UNKNOWN_TYPE'
      ? `事件类型未登记，拒绝写入：${reason}`
      : `事件未通过无损 JSON 校验，拒绝写入：${reason}`;
  logger.warn(message, {
    sessionId,
    eventSeq: event.seq,
    eventType: event.type,
    reason,
  });
  const appError = new AppError(
    `${message}（session=${sessionId} type=${event.type} seq=${event.seq}）`,
    ErrorCategory.VALIDATION,
    ErrorSeverity.HIGH,
    errorCode,
    { sessionId, eventSeq: event.seq, eventType: event.type, reason }
  );
  void handleError(appError, {
    module: 'session:event-log',
    action: 'append:reject',
    context: { sessionId, eventType: event.type },
  }).catch(() => {});
}
