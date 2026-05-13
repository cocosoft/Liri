/**
 * 对话转录管理器
 * 持久化完整对话历史到转录文件
 * 对齐 OpenClaw config/sessions/transcript.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { existsSync, writeFileSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export interface TranscriptConfig {
  sessionsDir: string;
  maxEntriesPerFile: number;
  format: 'jsonl' | 'json';
}

const DEFAULT_CONFIG: TranscriptConfig = {
  sessionsDir: join(process.cwd(), 'data', 'transcripts'),
  maxEntriesPerFile: 5000,
  format: 'jsonl',
};

export class SessionTranscript {
  private config: TranscriptConfig;
  private entries: Map<string, TranscriptEntry[]> = new Map();
  private mirrored = false;

  constructor(config: Partial<TranscriptConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!existsSync(this.config.sessionsDir)) {
      mkdirSync(this.config.sessionsDir, { recursive: true });
    }
  }

  addEntry(sessionId: string, entry: TranscriptEntry): void {
    const entries = this.entries.get(sessionId) || [];
    entries.push(entry);
    this.entries.set(sessionId, entries);

    if (this.mirrored) {
      this.writeMirror(sessionId, entry);
    }

    if (entries.length >= this.config.maxEntriesPerFile) {
      this.flush(sessionId);
    }
  }

  getEntries(sessionId: string): TranscriptEntry[] {
    const fromFile = this.loadFromFile(sessionId);
    const inMemory = this.entries.get(sessionId) || [];
    return [...fromFile, ...inMemory];
  }

  getRecentEntries(sessionId: string, count: number): TranscriptEntry[] {
    const all = this.getEntries(sessionId);
    return all.slice(-count);
  }

  async flush(sessionId: string): Promise<void> {
    const entries = this.entries.get(sessionId);
    if (!entries || entries.length === 0) return;

    const filePath = this.getFilePath(sessionId);
    try {
      if (this.config.format === 'jsonl') {
        const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
        appendFileSync(filePath, lines);
      } else {
        const existing = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf-8')) : [];
        writeFileSync(filePath, JSON.stringify([...existing, ...entries], null, 2));
      }
      this.entries.delete(sessionId);
      logger.debug(`转录已持久化: ${sessionId} (${entries.length} 条)`);
    } catch (error) {
      logger.error(`转录持久化失败: ${sessionId}`, error as Error);
    }
  }

  async flushAll(): Promise<void> {
    for (const sessionId of this.entries.keys()) {
      await this.flush(sessionId);
    }
  }

  enableMirroring(): void {
    this.mirrored = true;
  }

  disableMirroring(): void {
    this.mirrored = false;
  }

  private writeMirror(sessionId: string, entry: TranscriptEntry): void {
    const mirrorPath = join(this.config.sessionsDir, `${sessionId}.mirror.jsonl`);
    try {
      appendFileSync(mirrorPath, JSON.stringify(entry) + '\n');
    } catch (error) {
      logger.error(`转录镜像写入失败: ${sessionId}`, error as Error);
    }
  }

  private loadFromFile(sessionId: string): TranscriptEntry[] {
    const filePath = this.getFilePath(sessionId);
    if (!existsSync(filePath)) return [];

    try {
      const content = readFileSync(filePath, 'utf-8');
      if (this.config.format === 'jsonl') {
        return content
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
      }
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private getFilePath(sessionId: string): string {
    return join(this.config.sessionsDir, `${sessionId}.transcript.${this.config.format}`);
  }
}

export const sessionTranscript = new SessionTranscript();
