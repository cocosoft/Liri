import { readdir, stat, rename, mkdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface ArchiveResult {
  archivedCount: number;
  totalSizeSaved: number;
  errors: string[];
  archivePath: string;
}

export class TranscriptArchiver {
  private transcriptDir: string;
  private archiveDir: string;
  private retentionDays: number;

  constructor(transcriptDir?: string, retentionDays: number = 30) {
    this.transcriptDir = transcriptDir || './data/transcripts';
    this.archiveDir = join(this.transcriptDir, 'archive');
    this.retentionDays = retentionDays;
  }

  async archiveOldTranscripts(): Promise<ArchiveResult> {
    const result: ArchiveResult = {
      archivedCount: 0,
      totalSizeSaved: 0,
      errors: [],
      archivePath: this.archiveDir,
    };

    if (!existsSync(this.transcriptDir)) {
      logger.info('转录目录不存在，跳过归档');
      return result;
    }

    if (!existsSync(this.archiveDir)) {
      await mkdir(this.archiveDir, { recursive: true });
    }

    const cutoff = Date.now() - this.retentionDays * 86400000;
    const files = await readdir(this.transcriptDir);

    for (const file of files) {
      const filePath = join(this.transcriptDir, file);

      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) continue;

        const ext = extname(file);
        if (ext !== '.json' && ext !== '.jsonl') continue;

        if (fileStat.mtimeMs >= cutoff) continue;

        const gzPath = join(this.archiveDir, `${file}.gz`);

        await pipeline(
          createReadStream(filePath),
          createGzip(),
          createWriteStream(gzPath)
        );

        await rename(gzPath, join(this.archiveDir, file));

        const gzStat = await stat(join(this.archiveDir, file));
        const sizeSaved = fileStat.size - gzStat.size;

        result.archivedCount++;
        result.totalSizeSaved += Math.max(0, sizeSaved);
      } catch (err) {
        result.errors.push(
          `${file}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    logger.info('转录归档完成', {
      archivedCount: result.archivedCount,
      totalSizeSaved: result.totalSizeSaved,
      errors: result.errors.length,
    });

    return result;
  }
}

export const transcriptArchiver = new TranscriptArchiver();
