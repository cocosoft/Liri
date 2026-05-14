/**
 * SessionPersistenceManager 会话持久化管理
 * 对标 CC 的会话持久化机制
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * 序列化格式
 */
export type SerializationFormat = 'json' | 'jsonl' | 'ndjson';

/**
 * 快照元数据
 */
export interface SnapshotMetadata {
  sessionId: string;
  snapshotId: string;
  timestamp: number;
  format: SerializationFormat;
  size: number;
  messageCount: number;
  checksum: string;
}

/**
 * 恢复选项
 */
export interface RestoreOptions {
  maxMessages?: number;
  since?: number;
  until?: number;
}

/**
 * 持久化结果
 */
export interface PersistenceResult {
  success: boolean;
  filePath: string;
  size: number;
  messageCount: number;
  error?: string;
}

/**
 * 会话持久化管理器
 */
export class SessionPersistenceManager {
  private baseDir: string;
  private snapshots: Map<string, SnapshotMetadata> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(os.homedir(), '.py_app', 'sessions', 'persistence');
    this.ensureDir();
  }

  /**
   * 保存会话快照
   */
  async saveSnapshot(
    sessionId: string,
    messages: unknown[],
    format: SerializationFormat = 'json'
  ): Promise<PersistenceResult> {
    try {
      const snapshotId = `snap_${Date.now()}`;
      const dir = path.join(this.baseDir, sessionId);
      fs.mkdirSync(dir, { recursive: true });

      const ext = format === 'json' ? 'json' : 'jsonl';
      const filePath = path.join(dir, `${snapshotId}.${ext}`);

      let content: string;
      let checksum: string;

      if (format === 'json') {
        content = JSON.stringify(messages, null, 2);
        checksum = this.simpleHash(content);
      } else {
        content = messages.map((m) => JSON.stringify(m)).join('\n');
        checksum = this.simpleHash(content);
      }

      fs.writeFileSync(filePath, content, 'utf-8');

      const size = Buffer.byteLength(content, 'utf-8');
      const metadata: SnapshotMetadata = {
        sessionId,
        snapshotId,
        timestamp: Date.now(),
        format,
        size,
        messageCount: messages.length,
        checksum,
      };

      this.snapshots.set(snapshotId, metadata);
      this.saveMetadata(metadata);

      return { success: true, filePath, size, messageCount: messages.length };
    } catch (err) {
      return {
        success: false,
        filePath: '',
        size: 0,
        messageCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 恢复会话快照
   */
  async restoreSnapshot(
    sessionId: string,
    snapshotId: string,
    options?: RestoreOptions
  ): Promise<unknown[]> {
    const metadata = this.snapshots.get(snapshotId);

    if (!metadata || metadata.sessionId !== sessionId) {
      return [];
    }

    const ext = metadata.format === 'json' ? 'json' : 'jsonl';
    const filePath = path.join(this.baseDir, sessionId, `${snapshotId}.${ext}`);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let messages: unknown[] = [];

    if (metadata.format === 'json') {
      messages = JSON.parse(content);
    } else {
      messages = content.split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    }

    if (options?.since) {
      messages = messages.filter((m: any) => m.timestamp >= options.since!);
    }

    if (options?.until) {
      messages = messages.filter((m: any) => m.timestamp <= options.until!);
    }

    if (options?.maxMessages && messages.length > options.maxMessages) {
      messages = messages.slice(-options.maxMessages);
    }

    return messages;
  }

  /**
   * 列出会话快照
   */
  listSnapshots(sessionId: string): SnapshotMetadata[] {
    return Array.from(this.snapshots.values())
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 删除快照
   */
  deleteSnapshot(snapshotId: string): boolean {
    const metadata = this.snapshots.get(snapshotId);

    if (!metadata) return false;

    const ext = metadata.format === 'json' ? 'json' : 'jsonl';
    const filePath = path.join(this.baseDir, metadata.sessionId, `${snapshotId}.${ext}`);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      this.snapshots.delete(snapshotId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取存储统计
   */
  getStorageStats(): { totalSnapshots: number; totalSize: number; oldestTimestamp: number; newestTimestamp: number } {
    const snapshots = Array.from(this.snapshots.values());

    if (snapshots.length === 0) {
      return { totalSnapshots: 0, totalSize: 0, oldestTimestamp: 0, newestTimestamp: 0 };
    }

    return {
      totalSnapshots: snapshots.length,
      totalSize: snapshots.reduce((sum, s) => sum + s.size, 0),
      oldestTimestamp: Math.min(...snapshots.map((s) => s.timestamp)),
      newestTimestamp: Math.max(...snapshots.map((s) => s.timestamp)),
    };
  }

  /**
   * 确保目录存在
   */
  private ensureDir(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * 保存快照元数据
   */
  private saveMetadata(metadata: SnapshotMetadata): void {
    const metaPath = path.join(this.baseDir, 'metadata.json');
    const existing: Record<string, SnapshotMetadata> = {};

    try {
      if (fs.existsSync(metaPath)) {
        Object.assign(existing, JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
      }
    } catch {
    }

    existing[metadata.snapshotId] = metadata;

    const entries = Object.values(existing)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 1000);

    const trimmed: Record<string, SnapshotMetadata> = {};
    for (const entry of entries) {
      trimmed[entry.snapshotId] = entry;
    }

    fs.writeFileSync(metaPath, JSON.stringify(trimmed, null, 2), 'utf-8');
  }

  /**
   * 简单哈希
   */
  private simpleHash(content: string): string {
    let hash = 0;

    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

export const sessionPersistenceManager = new SessionPersistenceManager();
