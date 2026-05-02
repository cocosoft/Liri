/**
 * 压缩后清理
 * 基于CC源码 cc_code/backend/services/compact/postCompactCleanup.ts 实现
 *
 * 在自动压缩和手动压缩后执行，释放被追踪结构占用的内存。
 * 保持向后兼容，不删除现有代码。
 */

import { resetMicrocompactState } from './microCompact';

export function runPostCompactCleanup(querySource?: string): void {
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk';

  resetMicrocompactState();

  if (isMainThreadCompact) {
    try {
      const { clearSessionMessagesCache } = require('../../session/SessionStorage');
      if (typeof clearSessionMessagesCache === 'function') {
        clearSessionMessagesCache();
      }
    } catch {
      // SessionStorage可能尚未实现该函数，忽略
    }
  }
}
