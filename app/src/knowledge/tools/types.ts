// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识工具 - UI 契约类型
 *
 * 定义各知识工具 `ToolResult.result` 的真实输出结构（与工具实现对齐）：
 * - 成功路径：result 为对象/数组（见各类型注释）
 * - UI 渲染器据此做类型化解析，配合 `parseToolOutput` 使用
 */

import type { KnowledgeRoute } from '../../docs/knowledge-types.js';

/** 知识搜索输出 —— 工具 result 直接是 KnowledgeRoute[]（数组，非对象包裹） */
export type KnowledgeSearchOutput = KnowledgeRoute[];

/** 知识写入输出 —— result = { success, filePath, action } */
export interface KnowledgeWriteOutput {
  success?: boolean;
  filePath?: string;
  action?: 'created' | 'updated' | 'skipped';
  error?: string;
}

/** 知识删除输出 —— 成功 result = { title, filePath }；候选 result 为数组 [{ title, docPath }] */
export type KnowledgeDeleteOutput =
  | { title: string; filePath: string }
  | Array<{
      title: string;
      docPath?: string;
      filePath?: string;
      category?: string;
    }>;

/** 知识导入输出 —— result = { imported, skipped, total } */
export interface KnowledgeImportOutput {
  imported: number;
  skipped?: number;
  total?: number;
}

/** 知识导出输出 —— result = { exported, targetDir, format } */
export interface KnowledgeExportOutput {
  exported?: number;
  targetDir?: string;
  format?: string;
}

/** 快照列表输出 —— result 直接是 string[]（快照文件名，最新在前）；兼容对象包裹形式 */
export type KnowledgeSnapshotsOutput =
  | string[]
  | { title?: string; snapshots?: string[]; versions?: string[] };

/** 知识恢复输出 —— result = { title, snapshot } */
export interface KnowledgeRestoreOutput {
  title?: string;
  snapshot?: string;
}
