import type { Message } from '../types/message';
import type { SessionMetadata, SessionState } from '../types/session';
import type {
  SessionCheckpoint,
  CheckpointService,
  CheckpointDiff,
  CreateCheckpointParams,
} from '../types/checkpoint';
import type { CheckpointStorage } from '../types/checkpoint';
import { Logger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger();

export class SessionCheckpointService implements CheckpointService {
  private storage: CheckpointStorage;

  constructor(storage?: CheckpointStorage) {
    if (storage) {
      this.storage = storage;
    } else {
      this.storage = this.createDefaultStorage();
    }
  }

  private createDefaultStorage(): CheckpointStorage {
    const { createCheckpointDatabase } =
      require('./CheckpointDatabase') as typeof import('./CheckpointDatabase');
    return createCheckpointDatabase();
  }

  private generateCheckpointId(): string {
    return (
      'cp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 8)
    );
  }

  async createCheckpoint(
    params: CreateCheckpointParams
  ): Promise<SessionCheckpoint> {
    const sessionId = params.sessionId;

    const checkpoint: SessionCheckpoint = {
      id: this.generateCheckpointId(),
      sessionId,
      label: params.label,
      description: params.description,
      createdAt: Date.now(),
      messages: [],
      metadata: {} as SessionMetadata,
      state: 'active' as SessionState,
      tokenCount: params.tokenCount,
      autoCreated: params.autoCreated ?? false,
    };

    await this.storage.saveCheckpoint(checkpoint);

    logger.info('Checkpoint created', {
      checkpointId: checkpoint.id,
      sessionId,
      label: params.label,
      autoCreated: checkpoint.autoCreated,
    });

    return checkpoint;
  }

  async saveCheckpointWithData(
    sessionId: string,
    messages: Message[],
    metadata: SessionMetadata,
    state: SessionState,
    label?: string,
    description?: string,
    autoCreated?: boolean,
    tokenCount?: number
  ): Promise<SessionCheckpoint> {
    const checkpoint: SessionCheckpoint = {
      id: this.generateCheckpointId(),
      sessionId,
      label,
      description,
      createdAt: Date.now(),
      messages: JSON.parse(JSON.stringify(messages)),
      metadata: JSON.parse(JSON.stringify(metadata)),
      state,
      tokenCount,
      autoCreated: autoCreated ?? false,
    };

    await this.storage.saveCheckpoint(checkpoint);

    logger.info('Checkpoint saved with data', {
      checkpointId: checkpoint.id,
      sessionId,
      messageCount: messages.length,
      label,
      autoCreated: checkpoint.autoCreated,
    });

    return checkpoint;
  }

  async listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    return this.storage.loadCheckpoints(sessionId);
  }

  async getCheckpoint(checkpointId: string): Promise<SessionCheckpoint | null> {
    return this.storage.loadCheckpoint(checkpointId);
  }

  async rollbackToCheckpoint(
    checkpointId: string,
    currentSession: {
      messages: Message[];
      metadata: SessionMetadata;
      state: SessionState;
    }
  ): Promise<{
    messages: Message[];
    metadata: SessionMetadata;
    state: SessionState;
    diff: CheckpointDiff;
  }> {
    const checkpoint = await this.storage.loadCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new AppError(
        `Checkpoint not found: ${checkpointId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const diff = this.computeDiff(currentSession, checkpoint);

    logger.info('Rolled back to checkpoint', {
      checkpointId,
      sessionId: checkpoint.sessionId,
      diff,
    });

    return {
      messages: JSON.parse(JSON.stringify(checkpoint.messages)),
      metadata: JSON.parse(JSON.stringify(checkpoint.metadata)),
      state: checkpoint.state,
      diff,
    };
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    await this.storage.deleteCheckpoint(checkpointId);

    logger.info('Checkpoint deleted', { checkpointId });
  }

  async deleteSessionCheckpoints(sessionId: string): Promise<void> {
    await this.storage.deleteSessionCheckpoints(sessionId);

    logger.info('All checkpoints deleted for session', { sessionId });
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<SessionCheckpoint | null> {
    return this.storage.getLatestCheckpoint(sessionId);
  }

  async autoCreateCheckpoint(
    sessionId: string,
    messages: Message[],
    metadata: SessionMetadata,
    state: SessionState
  ): Promise<SessionCheckpoint> {
    const latestCheckpoint = await this.storage.getLatestCheckpoint(sessionId);

    if (
      latestCheckpoint &&
      latestCheckpoint.messages.length === messages.length
    ) {
      return latestCheckpoint;
    }

    return this.saveCheckpointWithData(
      sessionId,
      messages,
      metadata,
      state,
      undefined,
      undefined,
      true
    );
  }

  private computeDiff(
    current: {
      messages: Message[];
      metadata: SessionMetadata;
      state: SessionState;
    },
    checkpoint: SessionCheckpoint
  ): CheckpointDiff {
    const currentCount = current.messages.length;
    const checkpointCount = checkpoint.messages.length;
    const addedMessages =
      currentCount > checkpointCount ? currentCount - checkpointCount : 0;
    const removedMessages =
      checkpointCount > currentCount ? checkpointCount - currentCount : 0;
    const stateChanged = current.state !== checkpoint.state;
    const metadataChanged =
      JSON.stringify(current.metadata) !== JSON.stringify(checkpoint.metadata);

    const summaryParts: string[] = [];
    if (addedMessages > 0)
      summaryParts.push(`${addedMessages} messages will be removed`);
    if (removedMessages > 0)
      summaryParts.push(`${removedMessages} messages will be restored`);
    if (stateChanged)
      summaryParts.push(
        `state will change from ${current.state} to ${checkpoint.state}`
      );
    if (metadataChanged) summaryParts.push('metadata will be restored');

    const summary =
      summaryParts.length > 0
        ? summaryParts.join(', ') + ' after rollback'
        : 'no changes after rollback';

    return {
      addedMessages,
      removedMessages,
      stateChanged,
      metadataChanged,
      summary,
    };
  }
}

let checkpointServiceInstance: SessionCheckpointService | null = null;

export function getCheckpointService(): SessionCheckpointService {
  if (!checkpointServiceInstance) {
    checkpointServiceInstance = new SessionCheckpointService();
  }
  return checkpointServiceInstance;
}

export function createCheckpointService(
  storage?: CheckpointStorage
): SessionCheckpointService {
  return new SessionCheckpointService(storage);
}
