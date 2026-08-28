export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source?: KnowledgeSource;
  /** KB-TPL（2026-08-27）：创建文档时的归属目录（后端 create 按 category 路由到 base） */
  category?: string;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeSearchResult {
  id: string;
  title: string;
  content: string;
  category: string;
  score: number;
  matchType: string;
  docPath: string;
  tags?: string[];
  /** P2-7: 后端补充的真实文件元数据 */
  size?: number;
  updated_at?: number;
  /** KB-L4：创建时间（后端 search 可选补充；缺失时前端回退 0，不再硬编码语义） */
  created_at?: number;
  source?: KnowledgeSource;
}

export type KnowledgeSource =
  "manual" | "auto-memory" | "upload" | "chat-save" | "dream" | "compiled";

export interface KnowledgeBase {
  name: string;
  label: string;
  enabled: boolean;
  docCount: number;
  icon: string;
  createdAt: number;
  source: "system" | "user";
}

export interface KnowledgeFile {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category: string;
  docPath: string;
  size: number;
  updated_at: number;
  created_at: number;
  source: KnowledgeSource;
  base: string;
}

/** 搜索结果（瞬态，与持久化 KnowledgeFile 分离） */
export interface KnowledgeSearchHit {
  file: KnowledgeFile;
  score: number;
  matchType: "keyword" | "semantic" | "graph_rag" | "knowledge";
  domain?: string;
  snippet?: string;
}

/** 文档列表排序枚举（P3-1：自 DocFilterBar 收编，单一事实） */
export type KnowledgeSortBy = "updated" | "title" | "created";

// ─── FAQ（由 faq.ts 归并） ───

/** FAQ 条目（与后端 FAQEntry 对齐） */
export interface FAQEntry {
  id: string;
  knowledgeBaseName: string;
  question: string;
  similarQuestions: string[];
  answer: string;
  tags: string[];
  category: string;
  enabled: boolean;
  recommended: boolean;
  contentHash: string;
  embeddingStatus: "pending" | "done" | "failed";
  createdAt: number;
  updatedAt: number;
}

/** FAQ 批量导入结果 */
export interface FAQImportReport {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

// ─── 知识库配置（由 config.ts 归并） ───

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
