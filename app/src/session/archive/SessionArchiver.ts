import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { promises as fs } from 'fs';
import { ArchiveStorage } from './ArchiveStorage';
import type {
  ArchiveConfig,
  ArchiveResult,
  ArchiveTrigger,
  RestoreResult,
  ArchiveMetadata,
} from './ArchiveTypes';
import { DEFAULT_ARCHIVE_CONFIG } from './ArchiveTypes';
import type { UnifiedSession } from '../types/Session';
import type { UnifiedMessage } from '../types/Message';
import { EventLogStorage } from '../storage/EventLogStorage';

const logger = getLogger('session:archiver');

export interface ArchivableSession {
  id: string;
  status: string;
  messageCount: number;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  toUnifiedSession(): UnifiedSession;
  toUnifiedMessages(): UnifiedMessage[];
}

export class SessionArchiver {
  private storage: ArchiveStorage;
  private config: ArchiveConfig;
  private archiveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<ArchiveConfig>) {
    this.config = { ...DEFAULT_ARCHIVE_CONFIG, ...config };
    this.storage = new ArchiveStorage(this.config);
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
    logger.info('SessionArchiver initialized', {
      archiveRootDir: this.config.archiveRootDir,
    });
  }

  async archiveSession(
    session: ArchivableSession,
    trigger: ArchiveTrigger = 'manual'
  ): Promise<ArchiveResult> {
    const result: ArchiveResult = {
      sessionId: session.id,
      success: false,
      archivedAt: Date.now(),
    };

    try {
      const unifiedSession = session.toUnifiedSession();
      const messages = session.toUnifiedMessages();

      // D-2（2026-08-23）：打包完整 events.jsonl（事件溯源单一化——归档不裁剪、
      // 不写摘要事件，恢复后事件流完全一致；与 T-A 区间表 / T-D 对账无冲突）。
      let events: string | undefined;
      try {
        const eventLog = new EventLogStorage(session.id);
        if (eventLog.exists()) {
          events = await fs.readFile(eventLog.getFilePath(), 'utf-8');
        }
      } catch (e) {
        // @ignore-catch — 事件日志缺失/读取失败不影响消息归档
        logger.warn('归档时读取事件日志失败，仅归档消息投影', {
          sessionId: session.id,
          error: String(e),
        });
      }

      const serialized = JSON.stringify({
        session: unifiedSession,
        messages,
        events,
      });
      const originalSize = Buffer.byteLength(serialized, 'utf-8');

      const metadata: ArchiveMetadata = {
        sessionId: session.id,
        archivedAt: result.archivedAt,
        trigger,
        originalSize,
        compressedSize: originalSize,
        originalStatus: session.status,
        messageCount: session.messageCount,
        totalTokens: session.totalTokens,
        ttlDays: this.config.defaultTtlDays,
        eventCount: events
          ? events.split('\n').filter((l) => l.trim().length > 0).length
          : 0,
      };

      const archivePath = await this.storage.archive({
        session: unifiedSession,
        messages,
        metadata,
        events,
      });

      result.success = true;
      result.archivePath = archivePath;
      result.originalSize = originalSize;
      result.compressedSize = originalSize;

      logger.info('Session archived successfully', {
        sessionId: session.id,
        trigger,
        messageCount: session.messageCount,
      });
    } catch (e) {
      result.error = String(e);
      handleError(e, {
        module: 'sessions:archive',
        action: 'Failed to archive session',
      });
    }

    return result;
  }

  async restoreSession(archivePath: string): Promise<RestoreResult> {
    const result: RestoreResult = {
      sessionId: '',
      success: false,
      restoredAt: Date.now(),
    };

    try {
      const payload = await this.storage.restore(archivePath);
      result.sessionId = payload.metadata.sessionId;
      result.success = true;

      logger.info('Session restored successfully', {
        sessionId: payload.metadata.sessionId,
      });
    } catch (e) {
      result.error = String(e);
      handleError(e, {
        module: 'sessions:archive',
        action: 'Failed to restore session',
      });
    }

    return result;
  }

  async deleteArchive(archivePath: string): Promise<void> {
    await this.storage.delete(archivePath);
  }

  async listArchived(): Promise<ArchiveMetadata[]> {
    return this.storage.listArchived();
  }

  async getArchivePathFor(sessionId: string): Promise<string | null> {
    return this.storage.getArchivePathFor(sessionId);
  }

  async getStorageStats(): Promise<{
    count: number;
    totalSize: number;
    oldestArchive: number;
    newestArchive: number;
  }> {
    return this.storage.getStorageStats();
  }

  startAutoArchive(getSessions: () => ArchivableSession[]): void {
    this.stopAutoArchive();

    const checkIntervalMs = Math.min(
      this.config.autoArchiveIdleMinutes * 60 * 1000,
      3600000
    );

    this.archiveInterval = setInterval(async () => {
      try {
        const sessions = getSessions();
        const now = Date.now();
        let archived = 0;

        for (const session of sessions) {
          const idleMs = now - session.lastActivityAt;
          const idleMinutes = idleMs / (60 * 1000);
          const ageDays = (now - session.createdAt) / (24 * 60 * 60 * 1000);

          const isIdle = idleMinutes >= this.config.autoArchiveIdleMinutes;
          const isOld = ageDays >= this.config.autoArchiveMaxAgeDays;

          if (isIdle || isOld) {
            const trigger: ArchiveTrigger = isOld ? 'auto_age' : 'auto_idle';
            // P1-fix（H6）：去重 —— 已归档会话跳过，避免周期性重复归档
            // （每次覆盖同一文件，纯写放大）。getArchivePathFor 匹配时间戳版本路径。
            const existing = await this.storage.getArchivePathFor(session.id);
            if (existing) {
              logger.debug('Auto-archive skipped: session already archived', {
                sessionId: session.id,
                archivePath: existing,
              });
              continue;
            }
            await this.archiveSession(session, trigger);
            archived++;
          }
        }

        if (archived > 0) {
          logger.info('Auto-archive completed', {
            archived,
            totalChecked: sessions.length,
          });
        }
      } catch (e) {
        handleError(e, {
          module: 'sessions:archive',
          action: 'Auto-archive error',
        });
      }
    }, checkIntervalMs);

    this.archiveInterval.unref();
    logger.info('Auto-archive started', {
      intervalMs: checkIntervalMs,
      idleThresholdMinutes: this.config.autoArchiveIdleMinutes,
      ageThresholdDays: this.config.autoArchiveMaxAgeDays,
    });
  }

  stopAutoArchive(): void {
    if (this.archiveInterval) {
      clearInterval(this.archiveInterval);
      this.archiveInterval = null;
      logger.info('Auto-archive stopped');
    }
  }
}
