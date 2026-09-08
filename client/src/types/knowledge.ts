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
  /** B10 透出：keyword/语义命中行号（F2 行定位前置） */
  startLine?: number;
  endLine?: number;
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
  matchType:
    | "keyword"
    | "semantic"
    | "graph_rag"
    | "knowledge"
    | "username"
    | "title"
    | "directory";
  domain?: string;
  snippet?: string;
  /** B10 透出：keyword/语义命中行号（F2 行定位前置） */
  startLine?: number;
  endLine?: number;
}

/** 文档列表排序枚举（P3-1：自 DocFilterBar 收编，单一事实） */
export type KnowledgeSortBy = "updated" | "title" | "created";

// ─── R3 分桶搜索（rules/faqs 结构化桶） ───
export interface BucketedRuleItem {
  bucket: "rule";
  ruleId: string;
  kind: string;
  constraintStrength: "mandatory" | "should" | "may";
  /** 强度中文标签：必须/应/可（供徽标） */
  constraintLabel: string;
  statement: string;
  snippet: string;
  domain: string;
  sourceFile?: string;
  score: number;
}

export interface BucketedFaqItem {
  bucket: "faq";
  id: string;
  question: string;
  answer: string;
  category?: string;
  knowledgeBaseName: string;
  score: number;
}

/** B7：knowledge_records 结构化记录桶 */
export interface BucketedRecordItem {
  bucket: "record";
  recordId: string;
  type: string;
  key: string;
  data: Record<string, unknown>;
  evidence: Record<string, string>;
  domain: string;
  sourceFile: string;
  score: number;
}

/** B7：R4 原文块页码命中桶（F5：rawPath 供 PDF 内嵌预览） */
export interface BucketedSourceItem {
  bucket: "source";
  /** 可打开的编译页/文档相对路径 */
  docPath: string;
  /** 源 raw 文件相对 KB 根路径（如 raw/foo.pdf；F5 预览用） */
  rawPath?: string;
  title: string;
  page?: number;
  section?: string;
  text: string;
  score: number;
}

/** POST /v1/knowledge/search?buckets=1 响应（R3 docs/rules/faqs + B7 records/sources） */
export interface BucketedKnowledgeSearch {
  docs: KnowledgeSearchResult[];
  rules: BucketedRuleItem[];
  faqs: BucketedFaqItem[];
  records: BucketedRecordItem[];
  sources: BucketedSourceItem[];
}

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

/** 向量存储配置（B5 下架 sqlite_vec，当前仅 jsonl） */
export interface VectorStoreConfig {
  type: "jsonl";
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
