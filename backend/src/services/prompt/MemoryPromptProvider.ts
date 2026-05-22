/**
 * 记忆提示提供者
 * 允许应用注入 MemoryManager 实现，供 systemPromptSection 读取记忆摘要
 */

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
