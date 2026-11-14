/**
 * FTS 文档类型（叶子模块）
 *
 * 2026-10-19（CI 循环依赖断环）：原定义在 `FTS5SearchEngine.ts`，而
 * `persistence/FTSIndexStore.ts` 反向 `import type` 它 ⇒ 静态环。
 * 纯类型下沉后由 `FTS5SearchEngine` 原样重导出，对外 API 不变。
 */

/**
 * 搜索文档
 */
export interface FTSDocument {
  id: string;
  title: string;
  content: string;
  category: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
