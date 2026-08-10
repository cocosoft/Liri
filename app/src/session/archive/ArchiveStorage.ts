import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { getLogger } from '@modules/monitoring';
import type { UnifiedSession } from '../types/Session';
import type { UnifiedMessage } from '../types/Message';
import type { ArchiveMetadata, ArchiveConfig } from './ArchiveTypes';

const logger = getLogger('session:archiveStorage');

export interface ArchivePayload {
  session: UnifiedSession;
  messages: UnifiedMessage[];
  metadata: ArchiveMetadata;
}

export class ArchiveStorage {
  private config: ArchiveConfig;

  constructor(config: ArchiveConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.config.archiveRootDir, { recursive: true });
    logger.info('ArchiveStorage initialized', {
      rootDir: this.config.archiveRootDir,
    });
  }

  async archive(payload: ArchivePayload): Promise<string> {
    const archivePath = this.getArchivePath(payload.metadata.sessionId);
    await fs.mkdir(dirname(archivePath), { recursive: true });

    const content = this.config.compressionEnabled
      ? JSON.stringify(payload)
      : JSON.stringify(payload, null, 2);

    await fs.writeFile(archivePath, content, 'utf-8');
    logger.info('Session archived', {
      sessionId: payload.metadata.sessionId,
      path: archivePath,
      size: content.length,
    });

    return archivePath;
  }

  async restore(archivePath: string): Promise<ArchivePayload> {
    const content = await fs.readFile(archivePath, 'utf-8');
    const payload: ArchivePayload = JSON.parse(content);

    logger.info('Session restored from archive', {
      sessionId: payload.metadata.sessionId,
      path: archivePath,
    });

    return payload;
  }

  async delete(archivePath: string): Promise<void> {
    await fs.unlink(archivePath);
    logger.info('Archive deleted', { path: archivePath });
  }

  async listArchived(): Promise<ArchiveMetadata[]> {
    const items: ArchiveMetadata[] = [];

    try {
      const entries = await fs.readdir(this.config.archiveRootDir);
      for (const entry of entries) {
        if (!entry.endsWith('.archive')) continue;
        const filePath = join(this.config.archiveRootDir, entry);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const payload: ArchivePayload = JSON.parse(content);
          items.push(payload.metadata);
        } catch (e) {
          logger.warn('Failed to read archive file', {
            path: filePath,
            error: String(e),
          });
        }
      }
    } catch (e) {
      logger.warn('Failed to list archives', { error: String(e) });
    }

    return items.sort((a, b) => b.archivedAt - a.archivedAt);
  }

  async getArchivePathFor(sessionId: string): Promise<string | null> {
    const path = this.getArchivePath(sessionId);
    try {
      await fs.access(path);
      return path;
    } catch {
      return null;
    }
  }

  async getStorageStats(): Promise<{
    count: number;
    totalSize: number;
    oldestArchive: number;
    newestArchive: number;
  }> {
    const metadataList = await this.listArchived();
    if (metadataList.length === 0) {
      return { count: 0, totalSize: 0, oldestArchive: 0, newestArchive: 0 };
    }

    const timestamps = metadataList.map((m) => m.archivedAt);
    return {
      count: metadataList.length,
      totalSize: metadataList.reduce((s, m) => s + m.compressedSize, 0),
      oldestArchive: Math.min(...timestamps),
      newestArchive: Math.max(...timestamps),
    };
  }

  private getArchivePath(sessionId: string): string {
    return join(this.config.archiveRootDir, `${sessionId}.archive`);
  }
}
