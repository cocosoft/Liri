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
