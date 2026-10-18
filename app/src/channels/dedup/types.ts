/**
 * 去重处理态（叶子模块）
 *
 * 2026-10-19（CI 循环依赖断环）：原定义在 `dedup/index.ts`，而 `DedupStore.ts`
 * 反向 `import type` 它 ⇒ 静态环。纯类型/常量下沉后由 `index.ts` 原样重导出。
 */

/** 消息处理态（唯一事实源；PR4） */
export const MESSAGE_PROCESSING_STATES = [
  'RECEIVED',
  'ADMITTED',
  'REJECTED',
] as const;

export type MessageProcessingState = (typeof MESSAGE_PROCESSING_STATES)[number];
