/**
 * 压缩后清理
 * * 在自动压缩和手动压缩后执行，释放被追踪结构占用的内存。
 *
 * ⚠️ 原注为"保持向后兼容，不删除现有代码"—— 2026-09-28 已按孤儿清理删除其中一处
 * （`resetMicrocompactState()`，理由见下方函数注释）；该措辞不再适用于本文件。
 */

import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('services:compact:postCompactCleanup');

/**
 * 压缩后清理：在自动压缩与手动压缩后执行，释放被追踪结构占用的内存。
 *
 * 2026-09-28（孤儿清理）：原先此处还调用 `resetMicrocompactState()` 重置**微压缩状态**——
 * 随 `microCompact.ts` 整体删除（其唯一外部入口 `CompactOrchestrator` 已无消费者，
 * 见 `.trae/specs/compaction-duplicate-subsystems.md` §7），微压缩已不存在 ⇒ **无状态可重置**，
 * 故一并移除该调用（本函数其余职责不变）。
 */
export function runPostCompactCleanup(querySource?: string): void {
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk';

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
