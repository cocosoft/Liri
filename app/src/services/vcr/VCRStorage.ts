import { mkdir, readdir, unlink, stat, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { resolveDataSubDir } from '@modules/core/paths';
import type { RecordedSession } from './SessionRecorder';

export interface VCRStorageEntry {
  filename: string;
  filepath: string;
  sessionId: string;
  startTime: number;
  messageCount: number;
  sizeBytes: number;
  createdAt: Date;
}

export class VCRStorage {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || resolveDataSubDir('vcr_recordings');
  }

  async ensureDirectory(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  async listRecordings(): Promise<VCRStorageEntry[]> {
    try {
      await this.ensureDirectory();
      const files = await readdir(this.baseDir);
      const jsonFiles = files.filter((f) => extname(f) === '.json');

      const entries: VCRStorageEntry[] = [];
      for (const file of jsonFiles) {
        const filepath = join(this.baseDir, file);
        try {
          const fileStat = await stat(filepath);
          entries.push({
            filename: file,
            filepath,
            sessionId: file.replace('.json', ''),
            startTime: fileStat.mtimeMs,
            messageCount: 0,
            sizeBytes: fileStat.size,
            createdAt: fileStat.birthtime,
          });
        } catch {
          continue;
        }
      }

      return entries.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
    } catch {
      return [];
    }
  }

  async readSession(filename: string): Promise<RecordedSession | null> {
    const filepath = join(this.baseDir, filename);
    try {
      const content = await readFile(filepath, { encoding: 'utf-8' });
      return JSON.parse(content) as RecordedSession;
    } catch {
      return null;
    }
  }

  async deleteRecording(filename: string): Promise<boolean> {
    const filepath = join(this.baseDir, filename);
    try {
      await unlink(filepath);
      return true;
    } catch {
      return false;
    }
  }

  async getTotalSize(): Promise<number> {
    const entries = await this.listRecordings();
    return entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  }

  async getRecordingCount(): Promise<number> {
    try {
      const files = await readdir(this.baseDir);
      return files.filter((f) => extname(f) === '.json').length;
    } catch {
      return 0;
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }
}
