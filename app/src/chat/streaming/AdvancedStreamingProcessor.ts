import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('chat:streaming:AdvancedStreamingProcessor');

export enum StreamState {
  IDLE = 'idle',
  ACTIVE = 'active',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export interface StreamChunk {
  id: string;
  index: number;
  content: string;
  timestamp: number;
  type: 'text' | 'tool_call' | 'tool_result' | 'error';
}

export interface StreamMetrics {
  totalChunks: number;
  totalBytes: number;
  startTime: number;
  endTime: number;
  duration: number;
  chunksPerSecond: number;
  bytesPerSecond: number;
  peakChunkRate: number;
}

export interface StreamSession {
  id: string;
  state: StreamState;
  chunks: StreamChunk[];
  buffer: StreamChunk[];
  metrics: StreamMetrics;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export type ChunkCallback = (chunk: StreamChunk) => void;
export type CompleteCallback = (session: StreamSession) => void;
export type ErrorCallback = (error: Error, sessionId: string) => void;
export type StateChangeCallback = (
  sessionId: string,
  oldState: StreamState,
  newState: StreamState
) => void;

export interface IAdvancedStreamingProcessor {
  createSession(metadata?: Record<string, unknown>): string;
  processChunk(
    sessionId: string,
    content: string,
    type?: StreamChunk['type']
  ): void;
  pauseStream(sessionId: string): boolean;
  resumeStream(sessionId: string): boolean;
  cancelStream(sessionId: string): boolean;
  getSession(sessionId: string): StreamSession | null;
  getSessionMetrics(sessionId: string): StreamMetrics | null;
  getAllSessions(): StreamSession[];
  onChunk(callback: ChunkCallback): () => void;
  onComplete(callback: CompleteCallback): () => void;
  onError(callback: ErrorCallback): () => void;
  onStateChange(callback: StateChangeCallback): () => void;
}

export class AdvancedStreamingProcessor implements IAdvancedStreamingProcessor {
  private sessions: Map<string, StreamSession> = new Map();
  private chunkCounter: number = 0;
  private chunkListeners: Set<ChunkCallback> = new Set();
  private completeListeners: Set<CompleteCallback> = new Set();
  private errorListeners: Set<ErrorCallback> = new Set();
  private stateChangeListeners: Set<StateChangeCallback> = new Set();
  private maxSessions: number;
  private maxBufferSize: number;

  constructor(maxSessions: number = 100, maxBufferSize: number = 1000) {
    this.maxSessions = maxSessions;
    this.maxBufferSize = maxBufferSize;
  }

  createSession(metadata?: Record<string, unknown>): string {
    if (this.sessions.size >= this.maxSessions) {
      const oldest = [...this.sessions.entries()].sort(
        ([, a], [, b]) => a.createdAt - b.createdAt
      )[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }

    const id = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const session: StreamSession = {
      id,
      state: StreamState.ACTIVE,
      chunks: [],
      buffer: [],
      metrics: {
        totalChunks: 0,
        totalBytes: 0,
        startTime: now,
        endTime: 0,
        duration: 0,
        chunksPerSecond: 0,
        bytesPerSecond: 0,
        peakChunkRate: 0,
      },
      createdAt: now,
      metadata,
    };

    this.sessions.set(id, session);
    return id;
  }

  processChunk(
    sessionId: string,
    content: string,
    type: StreamChunk['type'] = 'text'
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new AppError(
        `Stream session not found: ${sessionId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    if (
      session.state === StreamState.CANCELLED ||
      session.state === StreamState.COMPLETED
    )
      return;
    if (session.state === StreamState.PAUSED) {
      session.buffer.push({
        id: `chunk_${++this.chunkCounter}`,
        index: this.chunkCounter,
        content,
        timestamp: Date.now(),
        type,
      });
      return;
    }

    const chunk: StreamChunk = {
      id: `chunk_${++this.chunkCounter}`,
      index: this.chunkCounter,
      content,
      timestamp: Date.now(),
      type,
    };

    // 2026-08-24：接线 errorListeners——error chunk 到达时触发处理器错误事件
    // （此前 errorListeners 为空壳无触发点；错误只走 handleError 全局链路）
    if (type === 'error') {
      const procError = new Error(content || 'stream error');
      for (const listener of this.errorListeners) {
        try {
          listener(procError, sessionId);
        } catch (lerr) {
          handleError(lerr, {
            module: 'chat:streaming',
            action: 'errorListener',
          });
        }
      }
    }

    session.chunks.push(chunk);
    session.metrics.totalChunks++;
    session.metrics.totalBytes += content.length;

    const now = Date.now();
    const elapsed = (now - session.metrics.startTime) / 1000;
    if (elapsed > 0) {
      const currentRate = session.metrics.totalChunks / elapsed;
      if (currentRate > session.metrics.peakChunkRate) {
        session.metrics.peakChunkRate = currentRate;
      }
    }

    for (const listener of this.chunkListeners) {
      try {
        listener(chunk);
      } catch (err) {
        // ignore

        handleError(err, { module: 'chat:streaming', action: 'chunkListener' });
      }
    }
  }

  pauseStream(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== StreamState.ACTIVE) return false;
    const oldState = session.state;
    session.state = StreamState.PAUSED;
    this.notifyStateChange(sessionId, oldState, StreamState.PAUSED);
    return true;
  }

  resumeStream(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== StreamState.PAUSED) return false;
    const oldState = session.state;
    session.state = StreamState.ACTIVE;

    for (const buffered of session.buffer) {
      session.chunks.push(buffered);
      session.metrics.totalChunks++;
      session.metrics.totalBytes += buffered.content.length;
      for (const listener of this.chunkListeners) {
        try {
          listener(buffered);
        } catch (err) {
          // ignore

          handleError(err, {
            module: 'chat:streaming',
            action: 'flushListener',
          });
        }
      }
    }
    session.buffer = [];

    this.notifyStateChange(sessionId, oldState, StreamState.ACTIVE);
    return true;
  }

  cancelStream(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.state === StreamState.COMPLETED ||
      session.state === StreamState.CANCELLED
    )
      return false;
    const oldState = session.state;
    session.state = StreamState.CANCELLED;
    session.buffer = [];
    this.finalizeMetrics(session);
    this.notifyStateChange(sessionId, oldState, StreamState.CANCELLED);
    return true;
  }

  private finalizeMetrics(session: StreamSession): void {
    session.metrics.endTime = Date.now();
    session.metrics.duration =
      session.metrics.endTime - session.metrics.startTime;
    const elapsedSec = session.metrics.duration / 1000;
    if (elapsedSec > 0) {
      session.metrics.chunksPerSecond =
        session.metrics.totalChunks / elapsedSec;
      session.metrics.bytesPerSecond = session.metrics.totalBytes / elapsedSec;
    }
  }

  completeStream(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.state === StreamState.COMPLETED ||
      session.state === StreamState.CANCELLED
    )
      return false;
    const oldState = session.state;
    session.state = StreamState.COMPLETED;

    for (const buffered of session.buffer) {
      session.chunks.push(buffered);
      session.metrics.totalChunks++;
      session.metrics.totalBytes += buffered.content.length;
    }
    session.buffer = [];

    this.finalizeMetrics(session);
    this.notifyStateChange(sessionId, oldState, StreamState.COMPLETED);

    for (const listener of this.completeListeners) {
      try {
        listener(session);
      } catch (err) {
        // ignore

        handleError(err, {
          module: 'chat:streaming',
          action: 'sessionListener',
        });
      }
    }

    return true;
  }

  getSession(sessionId: string): StreamSession | null {
    return this.sessions.get(sessionId) || null;
  }

  getSessionMetrics(sessionId: string): StreamMetrics | null {
    const session = this.sessions.get(sessionId);
    return session ? { ...session.metrics } : null;
  }

  getAllSessions(): StreamSession[] {
    return [...this.sessions.values()];
  }

  onChunk(callback: ChunkCallback): () => void {
    this.chunkListeners.add(callback);
    return () => this.chunkListeners.delete(callback);
  }

  onComplete(callback: CompleteCallback): () => void {
    this.completeListeners.add(callback);
    return () => this.completeListeners.delete(callback);
  }

  onError(callback: ErrorCallback): () => void {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeListeners.add(callback);
    return () => this.stateChangeListeners.delete(callback);
  }

  private notifyStateChange(
    sessionId: string,
    oldState: StreamState,
    newState: StreamState
  ): void {
    for (const listener of this.stateChangeListeners) {
      try {
        listener(sessionId, oldState, newState);
      } catch (err) {
        // ignore

        handleError(err, {
          module: 'chat:streaming',
          action: 'stateChangeListener',
        });
      }
    }
  }

  removeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  clearCompletedSessions(): number {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (
        session.state === StreamState.COMPLETED ||
        session.state === StreamState.CANCELLED ||
        session.state === StreamState.ERROR
      ) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }
}

export const advancedStreamingProcessor = new AdvancedStreamingProcessor();
