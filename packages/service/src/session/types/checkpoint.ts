import type { Message } from './message';
import type { DataSessionStatus, SessionMetadata } from './session';

export interface SessionCheckpoint {
  id: string;
  sessionId: string;
  label?: string;
  description?: string;
  createdAt: number;
  messages: Message[];
  metadata: SessionMetadata;
  state: DataSessionStatus;
  tokenCount?: number;
  autoCreated: boolean;
}

export interface CheckpointDiff {
  addedMessages: number;
  removedMessages: number;
  stateChanged: boolean;
  metadataChanged: boolean;
  summary: string;
}

export interface CreateCheckpointParams {
  sessionId: string;
  label?: string;
  description?: string;
  autoCreated?: boolean;
  tokenCount?: number;
  /** 附加 metadata（如 abortRecovery 标记），与既有 metadata 合并 */
  metadata?: SessionMetadata;
}

export interface CheckpointStorage {
  saveCheckpoint(checkpoint: SessionCheckpoint): Promise<void>;
  loadCheckpoint(checkpointId: string): Promise<SessionCheckpoint | null>;
  loadCheckpoints(sessionId: string): Promise<SessionCheckpoint[]>;
  deleteCheckpoint(checkpointId: string): Promise<void>;
  deleteSessionCheckpoints(sessionId: string): Promise<void>;
  getCheckpointCount(sessionId: string): Promise<number>;
  getLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | null>;
}

export interface CheckpointService {
  createCheckpoint(params: CreateCheckpointParams): Promise<SessionCheckpoint>;
  listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]>;
  getCheckpoint(checkpointId: string): Promise<SessionCheckpoint | null>;
  rollbackToCheckpoint(
    checkpointId: string,
    currentSession: {
      messages: Message[];
      metadata: SessionMetadata;
      state: DataSessionStatus;
    }
  ): Promise<{
    messages: Message[];
    metadata: SessionMetadata;
    state: DataSessionStatus;
    diff: CheckpointDiff;
  }>;
  deleteCheckpoint(checkpointId: string): Promise<void>;
  getLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | null>;
  autoCreateCheckpoint(
    sessionId: string,
    messages: Message[],
    metadata: SessionMetadata,
    state: DataSessionStatus
  ): Promise<SessionCheckpoint>;
}

export const CHECKPOINT_MAX_AUTO = 50;
export const CHECKPOINT_TABLE = 'session_checkpoints';
