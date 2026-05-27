/**
 * 备份模块导出
 */

export { BackupManager, createDefaultBackupManager } from './BackupManager.js';

export type {
  DatabaseEntry,
  BackupResult,
  RestoreResult,
  CleanupResult,
  BackupConfig,
} from './BackupManager.js';
