/** 知识库搜索配置 */
export interface KnowledgeSearchConfig {
  keywordWeight: number;
  semanticWeight: number;
  semanticThreshold: number;
  knowledgeDocBoost: number;
}

/** 向量存储配置 */
export interface VectorStoreConfig {
  type: "jsonl" | "sqlite_vec";
  topK: number;
  minScore: number;
}

/** 知识库完整配置 */
export interface KnowledgeConfigData {
  version: number;
  search: KnowledgeSearchConfig;
  linter: { staleDays: number; maxIssues: number };
  scheduler: { intervalMs: number; runOnStart: boolean };
  compiler: {
    maxPagesPerFile: number;
    minPagesPerFile: number;
    qualityLintThreshold: number;
  };
  vectorStore?: VectorStoreConfig;
}
