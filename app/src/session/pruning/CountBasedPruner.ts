import type { Session } from '../models/Session';
import type {
  PruningStrategy,
  PruningResult,
  PruningContext,
  PruningConfig,
} from './PruningStrategy';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_MAX_MESSAGES = 500;

export class CountBasedPruner implements PruningStrategy {
  readonly name = 'CountBasedPruner';
  private maxMessages: number;

  constructor(maxMessages: number = DEFAULT_MAX_MESSAGES) {
    this.maxMessages = maxMessages;
  }

  shouldPrune(context: PruningContext): boolean {
    if (!context.session || context.session.messages.length === 0) {
      return false;
    }
    return context.session.messages.length > this.maxMessages;
  }

  prune(session: Session, config: PruningConfig): PruningResult {
    const before = session.messages.length;
    const excess = before - this.maxMessages;
    if (excess <= 0) {
      return {
        prunedMessageCount: 0,
        prunedTokenEstimate: 0,
        messagesRemaining: before,
        reason: 'Count-based pruning: no excess messages',
      };
    }

    const preserveFirst = Math.min(config.preserveFirstMessages, before);
    const preserveLast = Math.min(config.preserveLastMessages, before);

    const firstBlock = session.messages.slice(0, preserveFirst);
    const lastBlock = session.messages.slice(-preserveLast);
    const middleBlock = session.messages.slice(
      preserveFirst,
      -preserveLast || before
    );

    let prunedTokenEstimate = 0;
    const keepCount = Math.max(0, middleBlock.length - excess);
    const keptMiddle = middleBlock.slice(-keepCount);

    for (const msg of middleBlock.slice(0, middleBlock.length - keepCount)) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      prunedTokenEstimate += Math.ceil(content.length / 4);
    }

    session.messages = [...firstBlock, ...keptMiddle, ...lastBlock];

    logger.info('Count-based pruning completed', {
      sessionId: session.id,
      removed: before - session.messages.length,
      remaining: session.messages.length,
      tokenEstimate: prunedTokenEstimate,
    });

    return {
      prunedMessageCount: before - session.messages.length,
      prunedTokenEstimate,
      messagesRemaining: session.messages.length,
      reason: `Count-based pruning: removed ${before - session.messages.length} messages (limit: ${this.maxMessages})`,
    };
  }
}
