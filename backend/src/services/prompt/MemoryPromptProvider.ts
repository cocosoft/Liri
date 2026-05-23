/**
 * 记忆提示提供者
 * 允许应用注入 MemoryManager 实现，供 systemPromptSection 读取记忆摘要
 */

import type { SessionContext } from '@modules/memory/types/SessionContext';

export interface MemoryQueryResult {
  summaries: string[];
  totalCount: number;
}

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
