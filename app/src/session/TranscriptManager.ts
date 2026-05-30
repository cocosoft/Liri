/**
 * Transcript管理器
 */

import { writeFile, readFile, mkdir, stat, unlink, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { resolveDataDir } from '@modules/config/paths';

import { UnifiedMessage, MessageType, MessageRole } from './types/Message.js';
import type {
  UnifiedSession,
  SessionType,
  SessionFilter,
} from './types/Session.js';
import type {
  Transcript,
  TranscriptEntry,
  TranscriptAnnotation,
  LoadTranscriptOptions,
  SaveTranscriptOptions,
  TranscriptConfig,
  TranscriptStats,
  TranscriptSearchResult,
} from './types/Transcript.js';
import { isTranscriptMessage, isChainParticipant } from './types/Transcript.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

import type { UnifiedSessionStorage } from './storage/UnifiedStorage.js';

/**
 * Transcript管理器配置
 */
export interface TranscriptManagerConfig {
  basePath?: string;
  maxFileSize?: number;
  encoding?: 'jsonl' | 'json';
  enableCompression?: boolean;
  includeMetadata?: boolean;
}

/**
 * Transcript管理器类
 */
export class TranscriptManager {
  private storage: UnifiedSessionStorage;
  private config: Required<TranscriptManagerConfig>;
  private transcriptCache: Map<string, Transcript> = new Map();

  constructor(
    storage: UnifiedSessionStorage,
    config?: TranscriptManagerConfig
  ) {
    this.storage = storage;
    this.config = {
      basePath: config?.basePath ?? join(resolveDataDir(), 'transcripts'),
      maxFileSize: config?.maxFileSize ?? 50 * 1024 * 1024,
      encoding: config?.encoding ?? 'jsonl',
      enableCompression: config?.enableCompression ?? false,
      includeMetadata: config?.includeMetadata ?? true,
    };
  }

  /**
   * 记录消息到Transcript
   */
  async recordMessage(
    sessionId: string,
    message: UnifiedMessage
  ): Promise<void> {
    if (!this.shouldPersistMessage(message)) {
      return;
    }

    await this.storage.addMessage(sessionId, message);
    await this.appendToTranscriptFile(sessionId, message);
  }

  /**
   * 批量记录消息
   */
  async recordMessages(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<void> {
    const persistableMessages = messages.filter((msg) =>
      this.shouldPersistMessage(msg)
    );

    if (persistableMessages.length === 0) {
      return;
    }

    await this.storage.addMessages(sessionId, persistableMessages);

    for (const message of persistableMessages) {
      await this.appendToTranscriptFile(sessionId, message);
    }
  }

  /**
   * 加载Transcript
   */
  async loadTranscript(
    sessionId: string,
    options?: LoadTranscriptOptions
  ): Promise<Transcript | null> {
    const cached = this.transcriptCache.get(sessionId);
    if (cached) {
      return this.filterTranscript(cached, options);
    }

    const transcriptPath = this.getTranscriptPath(sessionId);
    if (!existsSync(transcriptPath)) {
      const session = await this.storage.getSession(sessionId);
      if (!session) {
        return null;
      }

      const messages = await this.storage.getMessages(sessionId, {
        limit: options?.limit,
        offset: options?.offset,
      });

      const transcript: Transcript = {
        sessionId,
        entries: messages,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        version: '1.0.0',
      };

      this.transcriptCache.set(sessionId, transcript);
      return this.filterTranscript(transcript, options);
    }

    try {
      const content = await readFile(transcriptPath, 'utf-8');
      const entries = this.parseTranscriptContent(content);
      const messages = await this.storage.getMessages(sessionId);

      const existingIds = new Set(messages.map((m) => m.id));
      const newEntries = entries.filter(
        (e) => !existingIds.has((e as UnifiedMessage).id)
      );

      const transcript: Transcript = {
        sessionId,
        entries: [...messages, ...newEntries],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: '1.0.0',
      };

      this.transcriptCache.set(sessionId, transcript);
      return this.filterTranscript(transcript, options);
    } catch (error) {
      logger.error(
        `Failed to load transcript for session ${sessionId}:`,
        error
      );
      return null;
    }
  }

  /**
   * 保存Transcript
   */
  async saveTranscript(
    sessionId: string,
    options?: SaveTranscriptOptions
  ): Promise<void> {
    const transcript = await this.loadTranscript(sessionId);
    if (!transcript) {
      return;
    }

    const transcriptPath = this.getTranscriptPath(sessionId);
    await mkdir(dirname(transcriptPath), { recursive: true });

    const content = this.serializeTranscript(transcript, options);
    await writeFile(transcriptPath, content, 'utf-8');
  }

  /**
   * 判断是否为Transcript消息（需要持久化）
   */
  shouldPersistMessage(message: UnifiedMessage): boolean {
    if (!isTranscriptMessage(message)) {
      return false;
    }

    if (message.type === MessageType.PROGRESS) {
      return false;
    }

    return isChainParticipant({ type: message.type as any });
  }

  /**
   * 获取Transcript路径
   */
  getTranscriptPath(sessionId: string): string {
    return join(this.config.basePath, `${sessionId}.jsonl`);
  }

  /**
   * 获取Agent Transcript路径
   */
  getAgentTranscriptPath(
    agentId: string,
    sessionId: string,
    subdir?: string
  ): string {
    const basePath = join(this.config.basePath, sessionId, 'subagents');
    if (subdir) {
      return join(basePath, subdir, `agent-${agentId}.jsonl`);
    }
    return join(basePath, `agent-${agentId}.jsonl`);
  }

  /**
   * 获取Projects目录
   */
  getProjectsDir(): string {
    return join(this.config.basePath, 'projects');
  }

  /**
   * 获取Transcript统计信息
   */
  async getTranscriptStats(sessionId: string): Promise<TranscriptStats | null> {
    const transcript = await this.loadTranscript(sessionId);
    if (!transcript) {
      return null;
    }

    let fileSize = 0;
    const transcriptPath = this.getTranscriptPath(sessionId);
    try {
      const stats = await stat(transcriptPath);
      fileSize = stats.size;
    } catch {
      fileSize = 0;
    }

    return {
      totalEntries: transcript.entries.length,
      totalMessages: transcript.entries.filter((e) => isTranscriptMessage(e))
        .length,
      totalAnnotations: transcript.entries.filter(
        (e) => !isTranscriptMessage(e)
      ).length,
      fileSize,
      lastUpdated: transcript.updatedAt,
    };
  }

  /**
   * 搜索Transcript
   */
  async searchTranscript(
    sessionId: string,
    query: string
  ): Promise<TranscriptSearchResult[]> {
    const transcript = await this.loadTranscript(sessionId);
    if (!transcript) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    const matchedEntries: TranscriptEntry[] = [];

    for (const entry of transcript.entries) {
      if (isTranscriptMessage(entry)) {
        const content =
          typeof entry.content === 'string'
            ? entry.content
            : JSON.stringify(entry.content);
        if (content.toLowerCase().includes(lowerQuery)) {
          matchedEntries.push(entry);
        }
      }
    }

    return [
      {
        sessionId,
        entries: matchedEntries,
        matchedQuery: query,
        score: matchedEntries.length,
      },
    ];
  }

  /**
   * 清理旧Transcript
   */
  async cleanupOldTranscripts(maxAge: number): Promise<void> {
    const cutoffTime = Date.now() - maxAge;
    const sessions = await this.storage.listSessions();

    for (const session of sessions) {
      if (session.updatedAt < cutoffTime) {
        await this.deleteTranscript(session.id);
      }
    }
  }

  /**
   * 删除Transcript
   */
  async deleteTranscript(sessionId: string): Promise<void> {
    this.transcriptCache.delete(sessionId);

    const transcriptPath = this.getTranscriptPath(sessionId);
    try {
      await unlink(transcriptPath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }

  /**
   * 清除缓存
   */
  clearCache(sessionId?: string): void {
    if (sessionId) {
      this.transcriptCache.delete(sessionId);
    } else {
      this.transcriptCache.clear();
    }
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    await mkdir(this.config.basePath, { recursive: true });
  }

  /**
   * 关闭
   */
  async close(): Promise<void> {
    this.transcriptCache.clear();
  }

  private async appendToTranscriptFile(
    sessionId: string,
    message: UnifiedMessage
  ): Promise<void> {
    const transcriptPath = this.getTranscriptPath(sessionId);
    await mkdir(dirname(transcriptPath), { recursive: true });

    const entry =
      this.config.encoding === 'jsonl'
        ? JSON.stringify(message) + '\n'
        : JSON.stringify(message);

    try {
      const stats = await stat(transcriptPath).catch(() => null);
      if (stats && stats.size >= this.config.maxFileSize) {
        logger.warn(
          `Transcript file ${transcriptPath} exceeded max size, truncating`
        );
      }
    } catch {
      // File doesn't exist yet
    }

    await writeFile(transcriptPath, entry, { flag: 'a', encoding: 'utf-8' });
  }

  private parseTranscriptContent(content: string): TranscriptEntry[] {
    if (this.config.encoding === 'jsonl') {
      const lines = content.split('\n').filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line) as TranscriptEntry);
    }
    return JSON.parse(content) as TranscriptEntry[];
  }

  private serializeTranscript(
    transcript: Transcript,
    options?: SaveTranscriptOptions
  ): string {
    if (options?.encoding === 'json' || this.config.encoding === 'json') {
      return JSON.stringify(transcript.entries);
    }

    return (
      transcript.entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    );
  }

  private filterTranscript(
    transcript: Transcript,
    options?: LoadTranscriptOptions
  ): Transcript {
    if (!options) {
      return transcript;
    }

    let entries = [...transcript.entries];

    if (options.startDate) {
      entries = entries.filter(
        (e) => (e as UnifiedMessage).timestamp >= options.startDate!
      );
    }

    if (options.endDate) {
      entries = entries.filter(
        (e) => (e as UnifiedMessage).timestamp <= options.endDate!
      );
    }

    if (options.offset) {
      entries = entries.slice(options.offset);
    }

    if (options.limit) {
      entries = entries.slice(0, options.limit);
    }

    if (options.includeAnnotations === false) {
      entries = entries.filter((e) => isTranscriptMessage(e));
    }

    return {
      ...transcript,
      entries,
    };
  }
}

/**
 * 创建Transcript管理器
 */
export function createTranscriptManager(
  storage: UnifiedSessionStorage,
  config?: TranscriptManagerConfig
): TranscriptManager {
  return new TranscriptManager(storage, config);
}
