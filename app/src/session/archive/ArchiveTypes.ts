import { join } from 'path';
import { resolveDataDir } from '@modules/core';

export type ArchiveTrigger = 'manual' | 'auto_idle' | 'auto_size' | 'auto_age';

export interface ArchiveMetadata {
  sessionId: string;
  archivedAt: number;
  trigger: ArchiveTrigger;
  originalSize: number;
  compressedSize: number;
  originalStatus: string;
  messageCount: number;
  totalTokens: number;
  ttlDays?: number;
  /** D-2（2026-08-23）：归档事件日志行数（0 = 无事件日志） */
  eventCount?: number;
}

export interface ArchiveConfig {
  archiveRootDir: string;
  autoArchiveIdleMinutes: number;
  autoArchiveMaxAgeDays: number;
  autoArchiveMaxSessions: number;
  defaultTtlDays: number;
  compressionEnabled: boolean;
}

export interface ArchiveResult {
  sessionId: string;
  success: boolean;
  archivedAt: number;
  archivePath?: string;
  originalSize?: number;
  compressedSize?: number;
  error?: string;
}

export interface RestoreResult {
  sessionId: string;
  success: boolean;
  restoredAt: number;
  error?: string;
}

export const DEFAULT_ARCHIVE_CONFIG: ArchiveConfig = {
  archiveRootDir: join(resolveDataDir(), 'sessions', 'archive'),
  autoArchiveIdleMinutes: 7 * 24 * 60,
  autoArchiveMaxAgeDays: 30,
  autoArchiveMaxSessions: 500,
  defaultTtlDays: 90,
  compressionEnabled: true,
};
