// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FAQ 知识类型 — 类型定义
 */

/** FAQ 条目 */
export interface FAQEntry {
  id: string;
  /** 所属知识库 */
  knowledgeBaseName: string;
  /** 标准问题 */
  question: string;
  /** 相似问题（JSON 数组，提升匹配率） */
  similarQuestions: string[];
  /** 答案 */
  answer: string;
  /** 标签 */
  tags: string[];
  /** 分类 */
  category: string;
  /** 是否启用 */
  enabled: boolean;
  /** 是否推荐 */
  recommended: boolean;
  /** 去重哈希 SHA256(question + answer) */
  contentHash: string;
  /** 嵌入状态 */
  embeddingStatus: 'pending' | 'done' | 'failed';
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** FAQ 知识库配置 */
export interface FAQConfig {
  /** 索引模式 */
  indexMode: 'question_only' | 'question_answer';
  /** 问题索引模式 */
  questionIndexMode: 'combined' | 'separate';
  /** 每条目最多相似问题数 */
  maxSimilarQuestions: number;
}

/** FAQ 搜索参数 */
export interface FAQSearchParams {
  query: string;
  knowledgeBaseName?: string;
  category?: string;
  tags?: string[];
  topK?: number;
}

/** FAQ 批量导入结果 */
export interface FAQImportReport {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}
