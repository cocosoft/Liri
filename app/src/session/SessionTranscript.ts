/**
 * 对话转录管理器
 * 持久化完整对话历史到转录文件
 * 对齐 OpenClaw config/sessions/transcript.ts
 */

import { Logger, LogLevel } from '@modules/monitoring';
import {
  existsSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolveTranscriptsDir } from '@modules/core';

const logger = new Logger({ level: LogLevel.INFO });

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  agentName?: string;
  metadata?: Record<string, unknown>;
}

export interface TranscriptConfig {
  sessionsDir: string;
  maxEntriesPerFile: number;
  format: 'jsonl' | 'json';
}

const DEFAULT_CONFIG: TranscriptConfig = {
  sessionsDir: resolveTranscriptsDir(),
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

  /**
   * 获取脱敏后的转录内容
   * 对标 OpenClaw stripToolDetails：移除工具调用细节，保留角色和时间线
   *
   * @param sessionId 会话ID
   * @param options 脱敏选项
   * @returns 脱敏后的文本内容
   */
  getTranscriptWithSanitization(
    sessionId: string,
    options?: { stripToolDetails?: boolean; maxContentLength?: number }
  ): string {
    const entries = this.getEntries(sessionId);
    const stripTools = options?.stripToolDetails !== false;
    const maxLen = options?.maxContentLength ?? 500;

    const lines: string[] = [];
    for (const entry of entries) {
      const ts = new Date(entry.timestamp).toISOString();
      if (entry.role === 'tool' && stripTools) {
        const content = entry.content || '';
        const truncated =
          content.length > maxLen ? content.slice(0, maxLen) + '...' : content;
        lines.push(
          `[${ts}] TOOL${entry.toolName ? `(${entry.toolName})` : ''}: ${truncated}`
        );
      } else {
        lines.push(`[${ts}] ${entry.role.toUpperCase()}: ${entry.content}`);
      }
    }
    return lines.join('\n');
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

  /**
   * 按 agent 名称过滤转录条目
   * @param sessionId 会话ID
   * @param agentName agent 名称
   */
  getEntriesByAgent(sessionId: string, agentName: string): TranscriptEntry[] {
    return this.getEntries(sessionId).filter(
      (entry) => entry.agentName === agentName
    );
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
        const existing = existsSync(filePath)
          ? JSON.parse(readFileSync(filePath, 'utf-8'))
          : [];
        writeFileSync(
          filePath,
          JSON.stringify([...existing, ...entries], null, 2)
        );
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
    const mirrorPath = join(
      this.config.sessionsDir,
      `${sessionId}.mirror.jsonl`
    );
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
    return join(
      this.config.sessionsDir,
      `${sessionId}.transcript.${this.config.format}`
    );
  }
}

export const sessionTranscript = new SessionTranscript();
