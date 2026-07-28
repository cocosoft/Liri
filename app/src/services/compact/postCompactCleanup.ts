/**
 * 压缩后清理
 * * 在自动压缩和手动压缩后执行，释放被追踪结构占用的内存。
 * 保持向后兼容，不删除现有代码。
 */

import { resetMicrocompactState } from './microCompact';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services:compact:postCompactCleanup',
  level: LogLevel.INFO,
});

export function runPostCompactCleanup(querySource?: string): void {
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk';

  resetMicrocompactState();

  if (isMainThreadCompact) {
    // BUG-M fix: use dynamic import() instead of require() to avoid module resolution issues
    import('../../session/SessionStorage')
      .then((mod) => {
        const clearCache = (mod as Record<string, unknown>)
          .clearSessionMessagesCache;
        if (typeof clearCache === 'function') {
          clearCache();
        }
      })
      .catch((err: unknown) => {
        logger.debug('Operation skipped', {
          context: 'SessionStorage可能尚未实现该函数，忽略',
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }
}
