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
  /**
   * @param domain S5 / issue #15（2026-10-29）：可选知识域。提供方**可**据此限缩检索范围；
   *   未提供 ⇒ 全局检索（默认行为不变）。实现方允许忽略（接口向前兼容）。
   */
  getKnowledgeSummaries(
    query: string,
    limit?: number,
    domain?: string
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

/**
 * S5 / issue #15（2026-10-29）：当前轮次的知识域（来自会话 `metadata.domain`）。
 *
 * 与 `currentKnowledgeQuery` 同模式由组装入口每轮**覆盖式**设置（含清空），
 * 避免跨会话串域。合法性校验在消费侧（`knowledgeContext` 段）统一做。
 */
let currentKnowledgeDomain: string | null = null;

export function setCurrentKnowledgeDomain(domain: string | undefined): void {
  const trimmed = (domain ?? '').trim();
  currentKnowledgeDomain = trimmed ? trimmed : null;
}

export function getCurrentKnowledgeDomain(): string | null {
  return currentKnowledgeDomain;
}
