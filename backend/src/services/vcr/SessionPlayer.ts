import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { RecordedSession, RecordedMessage } from './SessionRecorder';

export type ReactionOptions = {
  speedMultiplier?: number;
  skipDelays?: boolean;
  maxMessages?: number;
  loopCount?: number;
  filterTypes?: Array<RecordedMessage['type']>;
  onMessage?: (message: RecordedMessage, index: number) => void | Promise<void>;
  onComplete?: (session: RecordedSession) => void | Promise<void>;
  onError?: (error: Error, message: RecordedMessage) => void | Promise<void>;
};

export class SessionPlayer {
  private currentSession: RecordedSession | null = null;
  private playing: boolean = false;
  private messageIndex: number = 0;
  private abortController: AbortController | null = null;

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentSessionId(): string | null {
    return this.currentSession?.id ?? null;
  }

  get currentMessageIndex(): number {
    return this.messageIndex;
  }

  get totalMessages(): number {
    return this.currentSession?.messages.length ?? 0;
  }

  loadSession(session: RecordedSession): void {
    if (this.playing) {
      throw new Error('Cannot load session while playing.');
    }
    this.currentSession = structuredClone(session);
    this.messageIndex = 0;
  }

  async loadSessionFromFile(filePath: string): Promise<RecordedSession> {
    const content = await readFile(filePath, { encoding: 'utf-8' });
    const session = JSON.parse(content) as RecordedSession;

    if (!this.validateSession(session)) {
      throw new Error(`Invalid VCR session file: ${filePath}`);
    }

    this.currentSession = session;
    this.messageIndex = 0;
    return session;
  }

  private validateSession(session: unknown): session is RecordedSession {
    if (!session || typeof session !== 'object') return false;
    const s = session as Record<string, unknown>;
    return (
      typeof s.id === 'string' &&
      typeof s.startTime === 'number' &&
      Array.isArray(s.messages)
    );
  }

  async play(options: ReactionOptions = {}): Promise<RecordedSession> {
    if (!this.currentSession) {
      throw new Error(
        'No session loaded. Use loadSession() or loadSessionFromFile() first.'
      );
    }

    if (this.playing) {
      throw new Error('Already playing.');
    }

    this.playing = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const {
      speedMultiplier = 1,
      skipDelays = false,
      maxMessages,
      filterTypes,
      onMessage,
      onComplete,
      onError,
    } = options;

    const messages = filterTypes
      ? this.currentSession.messages.filter((m) => filterTypes.includes(m.type))
      : this.currentSession.messages;

    const effectiveMax = maxMessages ?? messages.length;
    const toPlay = messages.slice(0, effectiveMax);

    try {
      for (let i = 0; i < toPlay.length; i++) {
        if (signal.aborted) break;

        this.messageIndex = i;
        const message = toPlay[i];

        try {
          if (onMessage) {
            await Promise.resolve(onMessage(message, i));
          }
        } catch (error) {
          if (onError) {
            await Promise.resolve(
              onError(
                error instanceof Error ? error : new Error(String(error)),
                message
              )
            );
          }
        }

        if (!skipDelays && i < toPlay.length - 1) {
          const delay = this.calculateDelay(toPlay[i], toPlay[i + 1]);
          const adjustedDelay = delay / speedMultiplier;
          if (adjustedDelay > 0) {
            await this.sleep(adjustedDelay, signal);
          }
        }
      }

      if (onComplete) {
        await Promise.resolve(onComplete(this.currentSession));
      }

      return this.currentSession;
    } finally {
      this.playing = false;
    }
  }

  private calculateDelay(
    current: RecordedMessage,
    next: RecordedMessage
  ): number {
    const diff = next.timestamp - current.timestamp;
    const minDelay = 50;
    const maxDelay = 2000;
    return Math.min(Math.max(diff, minDelay), maxDelay);
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Playback aborted'));
      });
    });
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.playing = false;
  }

  reset(): void {
    this.abort();
    this.currentSession = null;
    this.messageIndex = 0;
  }

  getProgress(): { current: number; total: number; percent: number } {
    const total = this.currentSession?.messages.length ?? 0;
    const current = this.messageIndex + 1;
    return {
      current,
      total,
      percent: total > 0 ? Math.round((current / total) * 100) : 0,
    };
  }

  static async listRecordings(storageDir?: string): Promise<string[]> {
    const dir = storageDir || join(process.cwd(), 'vcr_recordings');

    try {
      const files = await readdir(dir);
      return files.filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  }

  static async loadRecording(
    filePath: string
  ): Promise<RecordedSession | null> {
    try {
      const content = await readFile(filePath, { encoding: 'utf-8' });
      const session = JSON.parse(content) as RecordedSession;

      if (
        session &&
        typeof session.id === 'string' &&
        Array.isArray(session.messages)
      ) {
        return session;
      }
      return null;
    } catch {
      return null;
    }
  }
}
