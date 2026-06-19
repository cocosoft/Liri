import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { resolveDataSubDir } from '@modules/core';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { configManager } from '@modules/config';

export interface RecordedMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string | Record<string, unknown>;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface RecordedSession {
  id: string;
  startTime: number;
  endTime: number | null;
  messages: RecordedMessage[];
  metadata: {
    recordingMode: 'vcr';
    sourceSession?: string;
    userAttributes?: Record<string, unknown>;
  };
}

export interface VCRStorage {
  sessionId: string;
  directory: string;
  filePath: string;
}

export class SessionRecorder {
  private currentSession: RecordedSession | null = null;
  private storageDir: string;
  private recording: boolean = false;
  private messageTimers: Map<string, number> = new Map();

  constructor(storageDir?: string) {
    this.storageDir = storageDir || resolveDataSubDir('vcr_recordings');
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get currentSessionId(): string | null {
    return this.currentSession?.id ?? null;
  }

  start(sessionId?: string): RecordedSession {
    if (this.recording) {
      throw new AppError(
        'Already recording. Stop current recording first.',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.currentSession = {
      id: sessionId || `vcr_${Date.now()}_${randomUUID().slice(0, 8)}`,
      startTime: Date.now(),
      endTime: null,
      messages: [],
      metadata: {
        recordingMode: 'vcr',
      },
    };

    this.recording = true;
    return this.currentSession;
  }

  stop(): RecordedSession {
    if (!this.recording || !this.currentSession) {
      throw new AppError(
        'No active recording.',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.currentSession.endTime = Date.now();
    this.recording = false;
    const session = this.currentSession;
    this.currentSession = null;
    return session;
  }

  recordMessage(
    type: RecordedMessage['type'],
    content: string | Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): string {
    if (!this.recording || !this.currentSession) {
      throw new AppError(
        'Not recording.',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const id = `msg_${this.currentSession.messages.length}_${randomUUID().slice(0, 6)}`;
    const message: RecordedMessage = {
      id,
      type,
      content,
      timestamp: Date.now(),
      metadata,
    };

    this.currentSession.messages.push(message);
    return id;
  }

  recordUserInput(content: string): string {
    return this.recordMessage('user', content);
  }

  recordAssistantResponse(
    content: string,
    metadata?: Record<string, unknown>
  ): string {
    return this.recordMessage('assistant', content, metadata);
  }

  recordToolCall(name: string, args: Record<string, unknown>): string {
    return this.recordMessage('tool_use', { name, args });
  }

  recordToolResult(
    toolUseId: string,
    result: unknown,
    isError: boolean = false
  ): string {
    return this.recordMessage('tool_result', { toolUseId, result, isError });
  }

  getMessages(): ReadonlyArray<RecordedMessage> {
    return this.currentSession?.messages ?? [];
  }

  getMessageCount(): number {
    return this.currentSession?.messages.length ?? 0;
  }

  getDuration(): number {
    if (!this.currentSession) return 0;
    const end = this.currentSession.endTime ?? Date.now();
    return end - this.currentSession.startTime;
  }

  async saveRecording(): Promise<string> {
    if (!this.currentSession || this.currentSession.messages.length === 0) {
      throw new AppError(
        'No recording data to save.',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const hash = createHash('sha1')
      .update(JSON.stringify(this.currentSession.messages))
      .digest('hex')
      .slice(0, 12);

    const session = {
      ...this.currentSession,
      endTime: this.currentSession.endTime ?? Date.now(),
    };
    const fileName = `${session.id}_${hash}.json`;
    const filePath = join(this.storageDir, fileName);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(session, null, 2), {
      encoding: 'utf-8',
      flag: 'w',
    });

    return filePath;
  }

  getSessionSummary(): Record<string, unknown> {
    if (!this.currentSession) return {};

    return {
      sessionId: this.currentSession.id,
      recording: this.recording,
      messageCount: this.currentSession.messages.length,
      duration: this.getDuration(),
      startTime: this.currentSession.startTime,
    };
  }

  static computeContentHash(content: unknown): string {
    return createHash('sha1').update(JSON.stringify(content)).digest('hex');
  }

  static getStorageDir(): string {
    return (
      configManager.env('VCR_STORAGE_DIR') ||
      resolveDataSubDir('vcr_recordings')
    );
  }
}
