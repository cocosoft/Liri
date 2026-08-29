/**
 * 平台监听器回调分发工具
 * 单条监听器异常隔离 + 记录，不中断后续监听器。
 * KB-CH-MONITOR-EMIT（2026-08-29）：22 个平台 monitor.ts 的 emit 循环此前
 * `catch { /* 忽略监听器异常 *​/ }` 静默吞错——任一平台心跳/事件处理故障完全不可见。
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('channels:monitor');

export function emitToListeners<E extends string>(
  listeners: Set<(event: E, data?: unknown) => void>,
  event: E,
  data?: unknown
): void {
  for (const listener of listeners) {
    try {
      listener(event, data);
    } catch (err) {
      logger.warn('平台监听器回调异常', {
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
