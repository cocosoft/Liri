import type { Session } from '../models/Session';
import type {
  PruningStrategy,
  PruningResult,
  PruningContext,
  PruningConfig,
} from './PruningStrategy';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'session:agePruner',
  level: LogLevel.INFO,
});

const DEFAULT_MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class AgeBasedPruner implements PruningStrategy {
  readonly name = 'AgeBasedPruner';
  private maxMessageAgeMs: number;

  constructor(maxMessageAgeMs: number = DEFAULT_MAX_MESSAGE_AGE_MS) {
    this.maxMessageAgeMs = maxMessageAgeMs;
  }

  shouldPrune(context: PruningContext): boolean {
    if (!context.session || context.session.messages.length === 0) {
      return false;
    }

    const now = Date.now();
    const oldestAllowed = now - this.maxMessageAgeMs;
    return context.session.messages.some((msg) => {
      const msgTime = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
      return msgTime > 0 && msgTime < oldestAllowed;
    });
  }

  prune(session: Session, _config: PruningConfig): PruningResult {
    const before = session.messages.length;
    const now = Date.now();
    const oldestAllowed = now - this.maxMessageAgeMs;

    let prunedTokenEstimate = 0;
    const kept = session.messages.filter((msg) => {
      const msgTime = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
      if (msgTime > 0 && msgTime < oldestAllowed) {
        const content = typeof msg.content === 'string' ? msg.content : '';
        prunedTokenEstimate += Math.ceil(content.length / 4);
        return false;
      }
      return true;
    });

    session.messages = kept;

    logger.info('Age-based pruning completed', {
      sessionId: session.id,
      removed: before - kept.length,
      remaining: kept.length,
      tokenEstimate: prunedTokenEstimate,
    });

    return {
      prunedMessageCount: before - kept.length,
      prunedTokenEstimate,
      messagesRemaining: kept.length,
      reason: `Age-based pruning: removed ${before - kept.length} messages older than ${this.maxMessageAgeMs}ms`,
    };
  }
}
