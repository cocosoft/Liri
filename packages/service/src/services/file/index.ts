/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 文件管理系统 — 统一导出
 */

export { FileRegistry } from './FileRegistry';
export { FileGCService } from './FileGCService';
export { FileCleanupService } from './FileCleanupService';
export { FileStatsService } from './FileStatsService';
export {
  FileSource,
  type RegisterFileInput,
  type RegisterFileResult,
  type FileRecord,
  type FileListQuery,
  type FileListResult,
  type FileStats,
  type StoreZone,
  type MediaType,
} from './types';
export {
  generateSavedName,
  sanitizeFileName,
  computeMd5,
  computeMd5Stream,
  parseTimestampFromSavedName,
  parseMd5FromSavedName,
} from './fileNaming';
export {
  FILES_TABLE,
  FILES_FTS_TABLE,
  getCreateTableSqlList,
} from './fileSchema';
export { registerGeneratedMedia } from './registerMediaFile';
export type { GCResult, GCOptions } from './FileGCService';
export type { CleanupResult, CleanupOptions } from './FileCleanupService';
