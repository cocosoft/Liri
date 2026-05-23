/**
 * 知识库提示提供者
 * 允许应用注入知识库查询实现，供 knowledgeContext 系统提示词段落读取相关知识
 */
export interface KnowledgeSummary {
  title: string;
  content: string;
  category: string;
  score: number;
  docPath: string;
}

export interface KnowledgeQueryResult {
  summaries: KnowledgeSummary[];
  totalCount: number;
}

export interface KnowledgeQueryProvider {
  getKnowledgeSummaries(
    query: string,
    limit?: number
  ): Promise<KnowledgeQueryResult>;
}

let provider: KnowledgeQueryProvider | null = null;

export function setKnowledgeQueryProvider(p: KnowledgeQueryProvider): void {
  provider = p;
}

export function getKnowledgeQueryProvider(): KnowledgeQueryProvider | null {
  return provider;
}

let currentKnowledgeQuery: string | null = null;

export function setCurrentKnowledgeQuery(query: string): void {
  currentKnowledgeQuery = query;
}

export function getCurrentKnowledgeQuery(): string | null {
  return currentKnowledgeQuery;
}
