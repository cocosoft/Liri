/**
 * 压缩后清理
 * * 在自动压缩和手动压缩后执行，释放被追踪结构占用的内存。
 * 保持向后兼容，不删除现有代码。
 */

import { resetMicrocompactState } from './microCompact';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'services:compact:postCompactCleanup', level: LogLevel.INFO });

export function runPostCompactCleanup(querySource?: string): void {
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk';

  resetMicrocompactState();

  if (isMainThreadCompact) {
    try {
      const {
        clearSessionMessagesCache,
      } = require('../../session/SessionStorage');
      if (typeof clearSessionMessagesCache === 'function') {
        clearSessionMessagesCache();
      }
    } catch (err) {

      // SessionStorage可能尚未实现该函数，忽略

      logger.debug("Operation skipped", { context: "SessionStorage可能尚未实现该函数，忽略", error: err instanceof Error ? err.message : String(err) });

    }
  }
}
