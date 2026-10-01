/**
 * 记忆提示提供者
 * 允许应用注入 MemoryManager 实现，供 systemPromptSection 读取记忆摘要
 */

import type { SessionContext } from '@modules/memory/types/SessionContext';
// 2026-10-01 D-166（`R00-001` 倒挂收口）：`MemoryQueryResult` 已**随 memory 域下沉**
// （其唯一消费者是 `memory`(infra) 的 `MemorySummarizer`）⇒ 此处改为**反向引用**（service→infra 合法 ✓）。
// 与本文件既有的 `SessionContext` 引用方向一致。
import type { MemoryQueryResult } from '@modules/memory/types/MemoryQueryResult';

export type { MemoryQueryResult };

export interface MemoryQueryProvider {
  getMemorySummaries(limit?: number): Promise<MemoryQueryResult>;
}

let provider: MemoryQueryProvider | null = null;

export function setMemoryQueryProvider(p: MemoryQueryProvider): void {
  provider = p;
}

export function getMemoryQueryProvider(): MemoryQueryProvider | null {
  return provider;
}

export function clearMemoryQueryProvider(): void {
  provider = null;
}

let currentSessionContext: SessionContext | null = null;

export function setCurrentSessionContext(ctx: SessionContext | null): void {
  currentSessionContext = ctx;
}

export function getCurrentSessionContext(): SessionContext | null {
  return currentSessionContext;
}
