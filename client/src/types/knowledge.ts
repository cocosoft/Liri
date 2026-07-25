export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source?: KnowledgeSource;
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
