/**
 * 知识库共享常量
 *
 * 从 KnowledgePage/KnowledgeBaseList 两方提取归并。
 */

/** 文档来源标签映射 */
export const sourceLabels: Record<string, string> = {
  manual: "手动创建",
  "auto-memory": "自动记忆",
  upload: "文件上传",
  "chat-save": "聊天保存",
  dream: "梦境生成",
  compiled: "LLM编译",
};

/** 文件列表排序选项 */
export const sortOptions = [
  { key: "name", label: "名称" },
  { key: "createdAt", label: "创建时间" },
  { key: "updatedAt", label: "更新时间" },
] as const;

/** 来源类型筛选选项 */
export const sourceFilterOptions = [
  { key: "all", label: "全部" },
  { key: "manual", label: "手动创建" },
  { key: "upload", label: "文件上传" },
  { key: "chat-save", label: "聊天保存" },
  { key: "dream", label: "梦境生成" },
  { key: "compiled", label: "LLM编译" },
] as const;
