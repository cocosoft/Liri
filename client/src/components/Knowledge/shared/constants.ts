/**
 * 知识库共享常量
 *
 * 从 KnowledgePage/KnowledgeBaseList 两方提取归并。
 */

/** 文档来源 i18n 键映射（渲染处用 t() 取值） */
export const sourceLabelKeys: Record<string, string> = {
  manual: "knowledge.sourceManual",
  "auto-memory": "knowledge.sourceAutoMemory",
  upload: "knowledge.sourceUpload",
  "chat-save": "knowledge.sourceChatSave",
  "quick-note": "knowledge.sourceQuickNote",
  dream: "knowledge.sourceDream",
  compiled: "knowledge.sourceCompiled",
};
