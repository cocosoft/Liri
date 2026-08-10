/**
 * 压缩后清理
 * * 在自动压缩和手动压缩后执行，释放被追踪结构占用的内存。
 * 保持向后兼容，不删除现有代码。
 */

import { resetMicrocompactState } from './microCompact';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('services:compact:postCompactCleanup');

export function runPostCompactCleanup(querySource?: string): void {
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk';

  resetMicrocompactState();

  if (isMainThreadCompact) {
    // BUG-M fix: use dynamic import() instead of require() to avoid module resolution issues
    import('../../session/SessionStorage.js')
      .then((mod) => {
        const clearCache = (mod as Record<string, unknown>)
          .clearSessionMessagesCache;
        if (typeof clearCache === 'function') {
          clearCache();
        }
      })
      .catch((err: unknown) => {
        handleError(err, {
          module: 'services:compact',
          action: 'clearSessionCache',
        });
      });
  }
}
