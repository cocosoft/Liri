/**
 * SessionTranscript 会话转录管理
 * 对标 CC 的会话转录能力
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolvePyappHome } from '@modules/core/paths';
import { handleError } from '@modules/error/handleError';

/**
 * 转录配置
 */
export interface TranscriptConfig {
  enabled: boolean;
  storePath: string;
  format: 'json' | 'jsonl';
  maxFileSize: number;
  rotateCount: number;
}

/**
 * 转录条目
 */
export interface TranscriptEntry {
  timestamp: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * 会话转录管理器
 */
export class SessionTranscript {
  private config: TranscriptConfig;
  private buffer: TranscriptEntry[] = [];
  private bufferSize: number = 50;

  constructor(config?: Partial<TranscriptConfig>) {
    this.config = {
      enabled: config?.enabled !== false,
      storePath:
        config?.storePath || path.join(resolvePyappHome(), 'transcripts'),
      format: config?.format || 'jsonl',
      maxFileSize: config?.maxFileSize || 10 * 1024 * 1024,
      rotateCount: config?.rotateCount || 5,
    };

    fs.mkdirSync(this.config.storePath, { recursive: true });
  }

  /**
   * 记录转录
   */
  record(
    sessionId: string,
    role: TranscriptEntry['role'],
    content: string,
    metadata?: Record<string, unknown>
  ): TranscriptEntry {
    const entry: TranscriptEntry = {
      timestamp: Date.now(),
      sessionId,
      role,
      content,
      metadata,
    };

    this.buffer.push(entry);

    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }

    return entry;
  }

  /**
   * 查询会话转录
   */
  query(
    sessionId: string,
    options?: { limit?: number; roles?: TranscriptEntry['role'][] }
  ): TranscriptEntry[] {
    const filePath = this.getSessionFilePath(sessionId);
    let entries: TranscriptEntry[] = [];

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');

      entries = content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    }

    if (options?.roles && options.roles.length > 0) {
      entries = entries.filter((e) => options.roles!.includes(e.role));
    }

    entries.sort((a, b) => a.timestamp - b.timestamp);

    if (options?.limit && options.limit > 0) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  /**
   * 导出转录
   */
  exportTranscript(sessionId: string): string {
    const entries = this.query(sessionId);
    const lines: string[] = [];

    for (const entry of entries) {
      const timestamp = new Date(entry.timestamp).toISOString();
      lines.push(
        `[${timestamp}] ${entry.role.toUpperCase()}: ${entry.content}`
      );
    }

    return lines.join('\n');
  }

  /**
   * 删除会话转录
   */
  delete(sessionId: string): boolean {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);

        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 获取存储大小
   */
  getStorageSize(): number {
    let total = 0;

    try {
      const files = fs.readdirSync(this.config.storePath);

      for (const file of files) {
        const filePath = path.join(this.config.storePath, file);
        total += fs.statSync(filePath).size;
      }
    } catch {} // @ignore-catch: 计算存储占用失败，返回 0

    return total;
  }

  /**
   * 刷新缓冲区
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const grouped = this.groupBySession(this.buffer);

    for (const [sessionId, entries] of Object.entries(grouped)) {
      this.appendToFile(sessionId, entries);
    }

    this.buffer = [];
  }

  /**
   * 按会话分组
   */
  private groupBySession(
    entries: TranscriptEntry[]
  ): Record<string, TranscriptEntry[]> {
    const grouped: Record<string, TranscriptEntry[]> = {};

    for (const entry of entries) {
      if (!grouped[entry.sessionId]) {
        grouped[entry.sessionId] = [];
      }

      grouped[entry.sessionId].push(entry);
    }

    return grouped;
  }

  /**
   * 追加到文件
   */
  private appendToFile(sessionId: string, entries: TranscriptEntry[]): void {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      this.rotateIfNeeded(filePath);

      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(filePath, lines, 'utf-8');
    } catch (err) {
      void handleError(err, { module: 'session:transcript', action: 'catch_error' });
    }
  }

  /**
   * 需要时轮转文件
   */
  private rotateIfNeeded(filePath: string): void {
    try {
      if (
        fs.existsSync(filePath) &&
        fs.statSync(filePath).size > this.config.maxFileSize
      ) {
        for (let i = this.config.rotateCount - 1; i > 0; i--) {
          const oldPath = `${filePath}.${i}`;
          const newPath = `${filePath}.${i + 1}`;

          if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
          }
        }

        fs.renameSync(filePath, `${filePath}.1`);
      }
    } catch (err) {
      void handleError(err, { module: 'session:transcript', action: 'catch_error' });
    }
  }

  /**
   * 获取会话文件路径
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(
      this.config.storePath,
      `session_${sessionId}.${this.config.format}`
    );
  }
}

export const sessionTranscript = new SessionTranscript();
