// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识工具-UI 契约类型
 *
 * 定义所有知识工具与 UI 渲染器之间的接口规范。
 * version 字段用于向前兼容——UI 组件校验 version，不匹配时 fallback。
 */

/** 知识搜索输出 */
export interface KnowledgeSearchOutput {
  query: string;
  items: Array<{
    title: string;
    score: number;
    content: string;
    snippet: string;
    path: string;
    category: string;
  }>;
  total: number;
  tookMs?: number;
}

/** 知识写入输出 */
export interface KnowledgeWriteOutput {
  title: string;
  filePath?: string;
  isNew?: boolean;
  success?: boolean;
  wordCount?: number;
  content?: string;
}

/** 知识删除输出 */
export interface KnowledgeDeleteOutput {
  title?: string;
  filePath?: string;
  docPath?: string;
  candidates?: Array<{ title: string; docPath?: string; filePath?: string; category?: string }>;
}

/** 知识导入输出 */
export interface KnowledgeImportOutput {
  imported: number;
  skipped?: number;
  errors?: number;
  files?: string[];
}

/** 知识导出输出 */
export interface KnowledgeExportOutput {
  exported?: number;
  count?: number;
  outputPath?: string;
  path?: string;
}

/** 快照列表输出 */
export interface KnowledgeSnapshotsOutput {
  title?: string;
  snapshots?: Array<{ filename?: string; name?: string; timestamp?: string }>;
  versions?: Array<{ filename?: string; name?: string; timestamp?: string }>;
}

/** 知识恢复输出 */
export interface KnowledgeRestoreOutput {
  title?: string;
  snapshot?: string;
  version?: string;
}

/** 统一的知识工具输出包装 */
export interface KnowledgeToolResult<T = unknown> {
  kind: 'knowledge';
  /** 契约版本号，UI 据此做兼容判断 */
  version: 1;
  /** 工具输出的业务数据 */
  data: T;
  /** 非致命告警 */
  warnings?: string[];
  /** 用户可理解的错误 */
  userErrors?: string[];
  /** 可操作的下一步建议 */
  actionable?: string[];
}
